document.addEventListener("DOMContentLoaded", async () => {
  const chromeApi = typeof chrome !== "undefined" ? chrome : null;
  const storageApi = chromeApi && chromeApi.storage ? chromeApi.storage : null;
  const storage = storageApi && storageApi.local ? storageApi.local : null;
  const i18nApi = chromeApi && chromeApi.i18n ? chromeApi.i18n : null;
  const tabsApi = chromeApi && chromeApi.tabs ? chromeApi.tabs : null;
  const scriptingApi = chromeApi && chromeApi.scripting ? chromeApi.scripting : null;
  const runtimeApi = chromeApi && chromeApi.runtime ? chromeApi.runtime : null;

  const STRINGS = {
    en: {
      appTitle: "YT Transcript Copier",
      loading: "Loading…",
      promptLabel: "DeepSeek prompt",
      promptHelp: "Your prompt is prepended before the video title and transcript.",
      copyButton: "Copy Title + Transcript",
      deepseekButton: "Send to DeepSeek",
      defaultPrompt: "Summarize the key points of this YouTube video in English based on the title and transcript. The transcript does not label speakers, so infer who is speaking when possible.\n==============\n",
      notYoutubeTitle: "Not a YouTube video page",
      navigateYoutube: "Navigate to a YouTube video first.",
      connectErrorTitle: "Could not connect to page",
      refreshError: "Try refreshing the YouTube page.",
      unreadableTitle: "Could not read title",
      notYoutubePage: "Not a YouTube video page.",
      extracting: "Extracting transcript…",
      copied: "Copied to clipboard!",
      openingDeepSeek: "Opening DeepSeek…",
      launchDeepSeekFailed: "Failed to launch DeepSeek tab.",
      sent: "Sent to DeepSeek!",
      sendFailed: "Failed to send.",
      unexpectedResponse: "Unexpected response from page."
    },
    zh: {
      appTitle: "YT 字幕复制器",
      loading: "加载中…",
      promptLabel: "DeepSeek 提示词",
      promptHelp: "这个提示词会加在视频标题和字幕前面。",
      copyButton: "复制标题和字幕",
      deepseekButton: "发送到 DeepSeek",
      defaultPrompt: "根据youtube节目的标题和字幕，用中文总结节目的要点。字幕中没有标注哪句话是谁说的，请尽量推导讲话人：\n==============\n",
      notYoutubeTitle: "这不是 YouTube 视频页面",
      navigateYoutube: "请先打开一个 YouTube 视频。",
      connectErrorTitle: "无法连接到页面",
      refreshError: "请刷新 YouTube 页面后重试。",
      unreadableTitle: "无法读取标题",
      notYoutubePage: "这不是 YouTube 视频页面。",
      extracting: "正在提取字幕…",
      copied: "已复制到剪贴板！",
      openingDeepSeek: "正在打开 DeepSeek…",
      launchDeepSeekFailed: "无法打开 DeepSeek 标签页。",
      sent: "已发送到 DeepSeek！",
      sendFailed: "发送失败。",
      unexpectedResponse: "页面返回了意外结果。"
    }
  };

  const locale = getLocale();
  const strings = STRINGS[locale];
  const copyBtn = document.getElementById("copyBtn");
  const deepseekBtn = document.getElementById("deepseekBtn");
  const promptInput = document.getElementById("promptInput");
  const statusEl = document.getElementById("status");
  const videoTitleEl = document.getElementById("videoTitle");
  const appTitleEl = document.getElementById("appTitle");
  const promptLabelEl = document.getElementById("promptLabel");
  const promptHelpEl = document.getElementById("promptHelp");

  applyLocale();
  promptInput.value = await loadPrompt();
  promptInput.addEventListener("input", () => {
    savePrompt(promptInput.value);
  });

  function getLocale() {
    const language = i18nApi && typeof i18nApi.getUILanguage === "function"
      ? i18nApi.getUILanguage()
      : navigator.language || "en";
    return language.toLowerCase().startsWith("zh") ? "zh" : "en";
  }

  function applyLocale() {
    document.documentElement.lang = locale;
    appTitleEl.textContent = strings.appTitle;
    videoTitleEl.textContent = strings.loading;
    promptLabelEl.textContent = strings.promptLabel;
    promptHelpEl.textContent = strings.promptHelp;
    copyBtn.textContent = strings.copyButton;
    deepseekBtn.textContent = strings.deepseekButton;
  }

  function ensureContentScript(tabId) {
    return new Promise((resolve) => {
      tabsApi.sendMessage(tabId, { action: "ping" }, (response) => {
        if (runtimeApi.lastError || !response) {
          scriptingApi.executeScript(
            {
              target: { tabId },
              files: ["content.js"],
            },
            () => {
              if (runtimeApi.lastError) {
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

  function loadPrompt() {
    return new Promise((resolve) => {
      if (!storage) {
        resolve(strings.defaultPrompt);
        return;
      }

      storage.get(["deepseekPrompt"], (result) => {
        if (runtimeApi.lastError) {
          resolve(strings.defaultPrompt);
          return;
        }

        resolve(result.deepseekPrompt || strings.defaultPrompt);
      });
    });
  }

  function savePrompt(value) {
    if (!storage) {
      return;
    }

    storage.set({ deepseekPrompt: value });
  }

  function extractFromActiveTab() {
    return new Promise((resolve, reject) => {
      tabsApi.query({ active: true, currentWindow: true }, async (tabs) => {
        const tab = tabs[0];
        if (!tab || !tab.url || !tab.url.includes("youtube.com/watch")) {
          reject(new Error(strings.notYoutubePage));
          return;
        }

        const injected = await ensureContentScript(tab.id);
        if (!injected) {
          reject(new Error(strings.refreshError));
          return;
        }

        tabsApi.sendMessage(
          tab.id,
          { action: "extractTranscript" },
          (response) => {
            if (runtimeApi.lastError) {
              reject(new Error(strings.refreshError));
              return;
            }
            if (response && response.error) {
              reject(new Error(response.error));
              return;
            }
            if (response && response.title && response.transcript) {
              resolve(response);
            } else {
              reject(new Error(strings.unexpectedResponse));
            }
          }
        );
      });
    });
  }

  tabsApi.query({ active: true, currentWindow: true }, async (tabs) => {
    const tab = tabs[0];
    if (!tab || !tab.url || !tab.url.includes("youtube.com/watch")) {
      videoTitleEl.textContent = strings.notYoutubeTitle;
      copyBtn.disabled = true;
      deepseekBtn.disabled = true;
      promptInput.disabled = true;
      setStatus(strings.navigateYoutube, "error");
      return;
    }

    const injected = await ensureContentScript(tab.id);
    if (!injected) {
      videoTitleEl.textContent = strings.connectErrorTitle;
      promptInput.disabled = true;
      setStatus(strings.refreshError, "error");
      return;
    }

    tabsApi.sendMessage(tab.id, { action: "getTitle" }, (response) => {
      if (runtimeApi.lastError) {
        videoTitleEl.textContent = strings.connectErrorTitle;
        setStatus(strings.refreshError, "error");
        return;
      }
      if (response && response.title) {
        videoTitleEl.textContent = response.title;
      } else {
        videoTitleEl.textContent = strings.unreadableTitle;
      }
    });
  });

  copyBtn.addEventListener("click", async () => {
    copyBtn.disabled = true;
    setStatus(strings.extracting, "");

    try {
      const { title, transcript } = await extractFromActiveTab();
      const text = `Title: ${title}\n\n${transcript}`;
      await navigator.clipboard.writeText(text);
      setStatus(strings.copied, "success");
    } catch (err) {
      setStatus(err.message, "error");
    } finally {
      copyBtn.disabled = false;
    }
  });

  deepseekBtn.addEventListener("click", async () => {
    deepseekBtn.disabled = true;
    setStatus(strings.extracting, "");

    try {
      const { title, transcript } = await extractFromActiveTab();
      const prompt = promptInput.value;
      const text = `${prompt}Title: ${title}\n\n${transcript}`;

      setStatus(strings.openingDeepSeek, "");

      runtimeApi.sendMessage(
        { action: "sendToDeepSeek", text },
        (response) => {
          if (runtimeApi.lastError) {
            setStatus(strings.launchDeepSeekFailed, "error");
            deepseekBtn.disabled = false;
            return;
          }
          if (response && response.ok) {
            setStatus(strings.sent, "success");
          } else {
            setStatus(response?.error || strings.sendFailed, "error");
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
