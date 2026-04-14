// Background service worker.
// Handles opening DeepSeek in a new tab and injecting the transcript text.

const ext = globalThis.browser || chrome;

ext.runtime.onMessage.addListener((request, _sender, sendResponse) => {
  if (request.action === "sendToDeepSeek" && request.text) {
    handleSendToDeepSeek(request.text)
      .then(() => sendResponse({ ok: true }))
      .catch((err) => sendResponse({ error: err.message }));
    return true; // keep channel open for async
  }
});

/**
 * Open chat.deepseek.com in a new tab, wait for it to load,
 * then inject a script that pastes the text and submits.
 */
async function handleSendToDeepSeek(text) {
  const tab = await createTab({ url: "https://chat.deepseek.com" });

  await waitForTabComplete(tab.id);
  await sleep(2000);
  await executeDeepSeekScript(tab.id, text);
}

function createTab(createProperties) {
  if (globalThis.browser?.tabs?.create) {
    return globalThis.browser.tabs.create(createProperties);
  }

  return new Promise((resolve, reject) => {
    chrome.tabs.create(createProperties, (tab) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(tab);
    });
  });
}

/**
 * Wait for a tab to reach "complete" loading status.
 */
function waitForTabComplete(tabId, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ext.tabs.onUpdated.removeListener(listener);
      reject(new Error("Timed out waiting for DeepSeek page to load."));
    }, timeoutMs);

    function listener(updatedTabId, changeInfo) {
      if (updatedTabId === tabId && changeInfo.status === "complete") {
        ext.tabs.onUpdated.removeListener(listener);
        clearTimeout(timer);
        resolve();
      }
    }

    ext.tabs.onUpdated.addListener(listener);
  });
}

async function executeDeepSeekScript(tabId, text) {
  if (globalThis.browser?.tabs?.executeScript) {
    const payload = JSON.stringify(text);
    await globalThis.browser.tabs.executeScript(tabId, {
      code: `(${pasteAndSubmit.toString()})(${payload});`,
    });
    return;
  }

  if (chrome.scripting?.executeScript) {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: pasteAndSubmit,
      args: [text],
    });
    return;
  }

  if (chrome.tabs?.executeScript) {
    const payload = JSON.stringify(text);
    await new Promise((resolve, reject) => {
      chrome.tabs.executeScript(
        tabId,
        { code: `(${pasteAndSubmit.toString()})(${payload});` },
        () => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }
          resolve();
        }
      );
    });
    return;
  }

  throw new Error("Script injection is not supported in this browser.");
}

/**
 * This function runs IN the DeepSeek page context (injected via executeScript).
 * It finds the chat textarea, sets its value, and submits.
 */
function pasteAndSubmit(text) {
  const MAX_WAIT = 10000;
  const POLL_INTERVAL = 500;

  return new Promise((resolve, reject) => {
    let elapsed = 0;

    const interval = setInterval(() => {
      // Find the textarea — try multiple selectors
      const textarea =
        document.querySelector("#chat-input") ||
        document.querySelector("textarea") ||
        document.querySelector('[contenteditable="true"]');

      if (textarea) {
        clearInterval(interval);

        try {
          // Focus the element
          textarea.focus();

          if (textarea.tagName === "TEXTAREA" || textarea.tagName === "INPUT") {
            // Standard textarea: set value and dispatch input event for Vue reactivity
            textarea.value = text;
            textarea.dispatchEvent(new Event("input", { bubbles: true }));
            textarea.dispatchEvent(new Event("change", { bubbles: true }));
          } else {
            // contenteditable div
            textarea.textContent = text;
            textarea.dispatchEvent(new InputEvent("input", { bubbles: true, data: text }));
          }

          // Wait a moment for the UI to react, then press Enter
          setTimeout(() => {
            textarea.dispatchEvent(
              new KeyboardEvent("keydown", {
                key: "Enter",
                code: "Enter",
                keyCode: 13,
                which: 13,
                bubbles: true,
              })
            );
            resolve();
          }, 500);
        } catch (err) {
          reject(err);
        }
      } else {
        elapsed += POLL_INTERVAL;
        if (elapsed >= MAX_WAIT) {
          clearInterval(interval);
          reject(new Error("Could not find DeepSeek chat input."));
        }
      }
    }, POLL_INTERVAL);
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
