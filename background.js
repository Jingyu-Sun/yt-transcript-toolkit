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

  await waitForTabReady(tab.id);
  await sleep(1000);
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
 * Poll until the tab reaches "interactive", "complete", or has been
 * "loading" for over 3 seconds (stuck on slow third-party resources).
 * Uses tabs.get() polling — more reliable than onUpdated across browsers.
 */
function waitForTabReady(tabId, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();

    const poll = setInterval(() => {
      ext.tabs.get(tabId).then((tab) => {
        const elapsed = Date.now() - start;

        if (tab.status === "interactive" || tab.status === "complete") {
          clearInterval(poll);
          resolve();
        } else if (tab.status === "loading" && elapsed > 3000) {
          clearInterval(poll);
          resolve();
        } else if (elapsed > timeoutMs) {
          clearInterval(poll);
          reject(new Error("Timed out waiting for DeepSeek page to load."));
        }
      }).catch((err) => {
        clearInterval(poll);
        reject(err);
      });
    }, 500);
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
 * Runs IN the DeepSeek page context (injected via executeScript).
 * Inserts text via execCommand for framework compatibility, then submits.
 */
function pasteAndSubmit(text) {
  const MAX_WAIT = 30000;
  const POLL_INTERVAL = 500;

  return new Promise((resolve, reject) => {
    let elapsed = 0;

    const interval = setInterval(() => {
      const el =
        document.querySelector("#chat-input") ||
        document.querySelector("textarea") ||
        document.querySelector('[contenteditable="true"]');

      if (el) {
        clearInterval(interval);

        try {
          el.focus();

          // execCommand('insertText') triggers native input events that
          // React / Vue controlled components actually observe.
          const inserted = document.execCommand("insertText", false, text);

          if (!inserted) {
            if (el.tagName === "TEXTAREA" || el.tagName === "INPUT") {
              const proto = el.tagName === "TEXTAREA"
                ? HTMLTextAreaElement.prototype
                : HTMLInputElement.prototype;
              const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
              if (setter) {
                setter.call(el, text);
              } else {
                el.value = text;
              }
            } else {
              el.textContent = text;
            }
            el.dispatchEvent(new Event("input", { bubbles: true }));
          }

          setTimeout(() => {
            function simulateClick(target) {
              const opts = { bubbles: true, cancelable: true, composed: true };
              target.dispatchEvent(new PointerEvent("pointerdown", opts));
              target.dispatchEvent(new MouseEvent("mousedown", opts));
              target.dispatchEvent(new PointerEvent("pointerup", opts));
              target.dispatchEvent(new MouseEvent("mouseup", opts));
              target.dispatchEvent(new MouseEvent("click", opts));
            }

            // Walk up from the textarea to find the send button nearby,
            // avoiding unrelated buttons (e.g. sidebar toggle).
            let sendBtn = null;
            let container = el.parentElement;
            for (let i = 0; i < 5 && container && !sendBtn; i++) {
              sendBtn = container.querySelector(
                'div.ds-icon-button--sizing-icon[aria-disabled="false"]'
              );
              container = container.parentElement;
            }

            if (sendBtn) {
              simulateClick(sendBtn);
            } else {
              el.focus();
              el.dispatchEvent(
                new KeyboardEvent("keydown", {
                  key: "Enter",
                  code: "Enter",
                  keyCode: 13,
                  which: 13,
                  bubbles: true,
                })
              );
            }
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
