# YT Transcript Copier — Design Document

## Overview

A cross-browser extension (Chrome + Firefox) that copies a YouTube video's title and timestamped transcript to the clipboard, or sends it directly to DeepSeek for AI analysis.

## Architecture

```
popup.html/js  ──(chrome.tabs.sendMessage)──▶  content.js (injected into YouTube)
     │                                              │
     │                                              ├─ extracts video title from DOM
     │                                              ├─ clicks "Show Transcript" button
     │                                              ├─ waits for transcript panel to appear
     │                                              └─ scrapes timestamped segments
     │
     └──(chrome.runtime.sendMessage)──▶  background.js (service worker)
                                              │
                                              ├─ opens chat.deepseek.com in new tab
                                              ├─ waits for page load
                                              └─ injects script to paste text & submit
```

### File Roles

| File | Role |
|------|------|
| `manifest.json` | Active manifest used for whichever browser you are currently loading |
| `manifest.chrome.json` | Chrome manifest source — permissions, content scripts, MV3 service worker |
| `manifest.firefox.json` | Firefox manifest source — permissions, content scripts, background script |
| `popup.html` | Popup UI with two buttons: "Copy" and "Send to DeepSeek" |
| `popup.js` | Popup logic — extract transcript, copy to clipboard or delegate to background |
| `content.js` | YouTube DOM interaction — title extraction, transcript scraping |
| `background.js` | Shared background logic — opens DeepSeek tab, injects paste-and-submit script |
| `icons/` | Extension icons (16/48/128px) |

## Browser packaging

- Keep the real extension files in the project root.
- `manifest.chrome.json` stores the Chrome Manifest V3 configuration.
- `manifest.firefox.json` stores the Firefox-compatible background configuration.
- `manifest.json` is the active manifest used when loading the extension.
- To test in Chrome, make the Chrome manifest the active `manifest.json`.
- To test in Firefox, make the Firefox manifest the active `manifest.json`.
- Only the manifest changes between browsers; all JavaScript, HTML, and icons remain shared in the root folder.

## Key Design Decisions

### 1. Programmatic content script injection (popup.js)

**Problem:** Content scripts declared in `manifest.json` only inject into pages loaded *after* the extension is installed. Already-open YouTube tabs get "Could not connect to page" on first use.

**Solution:** `ensureContentScript()` sends a `ping` message first. If no response, it injects `content.js` via `chrome.scripting.executeScript()`. This requires the `scripting` permission.

### 2. Multi-language "Show Transcript" button detection (content.js)

**Problem:** The button label is localized — English: "Show transcript", Chinese: "内容转文字".

**Solution:** `TRANSCRIPT_LABELS` array in `findShowTranscriptButton()` checks both labels. Uses a 4-strategy cascade (aria-label → description section → broader description → full page) to handle YouTube's inconsistent DOM.

**To add a new language:** append the localized label to the `TRANSCRIPT_LABELS` array.

### 3. Transcript panel detection across browsers (content.js)

**Problem:** YouTube assigns different `target-id` attributes to the transcript engagement panel depending on browser and locale:
- Firefox: `target-id="PAmodern_transcript_view"`
- Chrome (Chinese locale): `target-id="null"`
- Possibly others: `engagement-panel-searchable-transcript`

**Solution:** `findTranscriptPanel()` uses a three-tier approach:
1. Check known `target-id` values with `visibility="ENGAGEMENT_PANEL_VISIBILITY_EXPANDED"`
2. Fallback: find *any* expanded engagement panel containing `.ytwTranscriptSegmentViewModelTimestamp` elements
3. Legacy: check for `ytd-transcript-renderer` (older YouTube layout)

The fallback (tier 2) is the most resilient — it identifies the panel by its content rather than its ID.

### 4. Transcript segment scraping (content.js)

**Modern layout (2025+):**
- Segments live inside `<transcript-segment-view-model>` custom elements
- Timestamp: `div.ytwTranscriptSegmentViewModelTimestamp`
- Text: `span.ytAttributedStringHost`
- Navigate from timestamp → parent `<transcript-segment-view-model>` → find text span

**Legacy layout:**
- Segments: `ytd-transcript-segment-renderer`
- Timestamp: `.segment-timestamp`
- Text: `.segment-text`

### 5. `waitForTranscriptPanel` observes attribute changes

The panel element may already exist in the DOM but with `visibility="HIDDEN"`. The MutationObserver watches `attributes` (specifically `visibility`) in addition to `childList` to catch the transition to `EXPANDED`.

### 6. Background service worker for DeepSeek integration (background.js)

**Problem:** When the popup opens a new tab, focus shifts and the popup closes — destroying its JS context. Any follow-up work (waiting for page load, injecting scripts) would be lost.

**Solution:** The popup extracts the transcript first, then sends it to the background service worker via `chrome.runtime.sendMessage`. The service worker:
1. Opens `chat.deepseek.com` in a new tab
2. Waits for `chrome.tabs.onUpdated` with `status === "complete"`
3. Waits an extra 2s for the Vue app to initialize
4. Injects `pasteAndSubmit()` via `chrome.scripting.executeScript` with the text as an argument

This requires `host_permissions` for `*://chat.deepseek.com/*`.

### 7. DeepSeek chat input interaction (background.js → pasteAndSubmit)

**Problem:** DeepSeek uses Vue.js with reactive data binding. Setting `textarea.value` alone doesn't update Vue's internal state, so the send button stays disabled.

**Solution:** After setting `.value`, dispatch both `input` and `change` events with `{ bubbles: true }` so Vue picks up the change. Then simulate Enter key via `KeyboardEvent("keydown")` to submit. The function polls for the textarea (up to 10s) since the Vue app may not have rendered it by the time our script runs.

**Input element selectors tried in order:** `#chat-input` → `textarea` → `[contenteditable="true"]`

## YouTube DOM Fragility

YouTube frequently changes its DOM structure. If the extension breaks after a YouTube update, the most likely failure points are:

1. **Transcript button** — label text or container element changed → update `TRANSCRIPT_LABELS` or button search selectors in `findShowTranscriptButton()`
2. **Panel target-id** — new value introduced → the tier-2 fallback in `findTranscriptPanel()` should still work; add the new ID to `KNOWN_IDS` for faster matching
3. **Segment element structure** — class names changed → update selectors in `scrapeTranscriptSegments()`, run the diagnostic snippets below

## DeepSeek DOM Fragility

If DeepSeek changes their chat interface:

1. **Chat input element** — selector changed → update the selectors in `pasteAndSubmit()` in `background.js`
2. **Submission method** — Enter key no longer submits → find the send button and `.click()` it instead
3. **Framework change** — may need different event dispatching strategy

## Diagnostic Snippets

### YouTube (DevTools console on a YouTube page with transcript open)

**List all engagement panels:**
```js
document.querySelectorAll('ytd-engagement-panel-section-list-renderer').forEach((el, i) => {
  console.log(`Panel ${i}: target-id="${el.getAttribute('target-id')}", visibility="${el.getAttribute('visibility')}"`);
});
```

**Inspect transcript segment structure:**
```js
const panel = document.querySelector('ytd-engagement-panel-section-list-renderer[visibility="ENGAGEMENT_PANEL_VISIBILITY_EXPANDED"]');
const ts = panel?.querySelectorAll('.ytwTranscriptSegmentViewModelTimestamp');
console.log('Timestamps:', ts?.length);
if (ts?.[0]) {
  const seg = ts[0].closest('transcript-segment-view-model') || ts[0].parentElement;
  console.log('Segment tag:', seg.tagName, 'class:', seg.className);
  console.log('Text span:', seg.querySelector('span.ytAttributedStringHost')?.textContent.substring(0, 80));
}
```

### DeepSeek (DevTools console on chat.deepseek.com)

**Find chat input:**
```js
const input = document.querySelector('#chat-input') || document.querySelector('textarea');
console.log('Tag:', input?.tagName, 'ID:', input?.id, 'Class:', input?.className);
```
