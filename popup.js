document.addEventListener("DOMContentLoaded", () => {
  const copyBtn = document.getElementById("copyBtn");
  const deepseekBtn = document.getElementById("deepseekBtn");
  const statusEl = document.getElementById("status");
  const videoTitleEl = document.getElementById("videoTitle");

  /**
   * Ensure the content script is injected into the given tab.
   * If the script is already present, sendMessage works and we resolve immediately.
   * If not (first use on an already-open tab), we inject it programmatically.
   */
  function ensureContentScript(tabId) {
    return new Promise((resolve) => {
      chrome.tabs.sendMessage(tabId, { action: "ping" }, (response) => {
        if (chrome.runtime.lastError || !response) {
          // Content script not loaded — inject it now
          chrome.scripting.executeScript(
            {
              target: { tabId },
              files: ["content.js"],
            },
            () => {
              if (chrome.runtime.lastError) {
                resolve(false);
              } else {
                resolve(true);
              }
            }
          );
        } else {
          resolve(true);
        }
      });
    });
  }

  /**
   * Extract title + transcript from the active YouTube tab.
   * Returns { title, transcript } on success, or throws on error.
   */
  function extractFromActiveTab() {
    return new Promise((resolve, reject) => {
      chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
        const tab = tabs[0];
        if (!tab || !tab.url || !tab.url.includes("youtube.com/watch")) {
          reject(new Error("Not a YouTube video page."));
          return;
        }

        const injected = await ensureContentScript(tab.id);
        if (!injected) {
          reject(new Error("Cannot connect to page. Try refreshing."));
          return;
        }

        chrome.tabs.sendMessage(
          tab.id,
          { action: "extractTranscript" },
          (response) => {
            if (chrome.runtime.lastError) {
              reject(new Error("Cannot connect to page. Try refreshing."));
              return;
            }
            if (response && response.error) {
              reject(new Error(response.error));
              return;
            }
            if (response && response.title && response.transcript) {
              resolve(response);
            } else {
              reject(new Error("Unexpected response from page."));
            }
          }
        );
      });
    });
  }

  // On popup open, fetch the current video title for display
  chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
    const tab = tabs[0];
    if (!tab || !tab.url || !tab.url.includes("youtube.com/watch")) {
      videoTitleEl.textContent = "Not a YouTube video page";
      copyBtn.disabled = true;
      deepseekBtn.disabled = true;
      setStatus("Navigate to a YouTube video first.", "error");
      return;
    }

    const injected = await ensureContentScript(tab.id);
    if (!injected) {
      videoTitleEl.textContent = "Could not connect to page";
      setStatus("Try refreshing the YouTube page.", "error");
      return;
    }

    chrome.tabs.sendMessage(tab.id, { action: "getTitle" }, (response) => {
      if (chrome.runtime.lastError) {
        videoTitleEl.textContent = "Could not connect to page";
        setStatus("Try refreshing the YouTube page.", "error");
        return;
      }
      if (response && response.title) {
        videoTitleEl.textContent = response.title;
      } else {
        videoTitleEl.textContent = "Could not read title";
      }
    });
  });

  // --- Copy to Clipboard ---
  copyBtn.addEventListener("click", async () => {
    copyBtn.disabled = true;
    setStatus("Extracting transcript…", "");

    try {
      const { title, transcript } = await extractFromActiveTab();
      const text = `Title: ${title}\n\n${transcript}`;
      await navigator.clipboard.writeText(text);
      setStatus("Copied to clipboard!", "success");
    } catch (err) {
      setStatus(err.message, "error");
    } finally {
      copyBtn.disabled = false;
    }
  });

  // --- Send to DeepSeek ---
  deepseekBtn.addEventListener("click", async () => {
    deepseekBtn.disabled = true;
    setStatus("Extracting transcript…", "");

    try {
      const { title, transcript } = await extractFromActiveTab();
      const PROMPT = "根据youtube节目的标题和字幕，用中文总结节目的要点。字幕中没有标注哪句话是谁说的，请尽量推导讲话人：\n==============\n";
      const text = `${PROMPT}Title: ${title}\n\n${transcript}`;

      setStatus("Opening DeepSeek…", "");

      // Send to background service worker, which will survive after popup closes
      chrome.runtime.sendMessage(
        { action: "sendToDeepSeek", text },
        (response) => {
          if (chrome.runtime.lastError) {
            setStatus("Failed to launch DeepSeek tab.", "error");
            deepseekBtn.disabled = false;
            return;
          }
          if (response && response.ok) {
            setStatus("Sent to DeepSeek!", "success");
          } else {
            setStatus(response?.error || "Failed to send.", "error");
          }
          deepseekBtn.disabled = false;
        }
      );
    } catch (err) {
      setStatus(err.message, "error");
      deepseekBtn.disabled = false;
    }
  });

  function setStatus(message, type) {
    statusEl.textContent = message;
    statusEl.className = type || "";
  }
});
