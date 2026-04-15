// Content script injected into YouTube watch pages.
// Listens for messages from the popup and extracts video title + transcript.

chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
  if (request.action === "ping") {
    sendResponse({ pong: true });
    return false;
  }

  if (request.action === "getTitle") {
    sendResponse({ title: getVideoTitle() });
    return false; // synchronous
  }

  if (request.action === "extractTranscript") {
    extractTranscript(request.includeTimestamps !== false)
      .then((result) => sendResponse(result))
      .catch((err) => sendResponse({ error: err.message }));
    return true; // keep message channel open for async response
  }
});

/**
 * Get the current video title.
 */
function getVideoTitle() {
  // Primary: rendered title in watch metadata
  const titleEl = document.querySelector(
    "h1.ytd-watch-metadata yt-formatted-string"
  );
  if (titleEl && titleEl.textContent.trim()) {
    return titleEl.textContent.trim();
  }
  // Fallback: meta tag
  const meta = document.querySelector('meta[name="title"]');
  if (meta && meta.content) {
    return meta.content;
  }
  return "Unknown Title";
}

/**
 * Main extraction flow:
 * 1. Check if transcript panel is already open
 * 2. If not, open it (expand description → click Show Transcript)
 * 3. Scrape segments
 */
async function extractTranscript(includeTimestamps) {
  const title = getVideoTitle();

  // Check if transcript panel is already visible
  let transcriptPanel = findTranscriptPanel();

  if (!transcriptPanel) {
    // Need to open the transcript panel
    await openTranscriptPanel();
    transcriptPanel = findTranscriptPanel();
    if (!transcriptPanel) {
      throw new Error("Could not open the transcript panel.");
    }
  }

  // Wait a moment for segments to fully render
  await sleep(500);

  const transcript = scrapeTranscriptSegments(includeTimestamps);
  if (!transcript) {
    throw new Error("Transcript panel is empty.");
  }

  return { title, transcript };
}

/**
 * Find the transcript panel in the DOM.
 * YouTube uses different target-ids across browsers and locales:
 *   - Firefox: target-id="PAmodern_transcript_view"
 *   - Chrome (some locales): target-id="null"
 * So we match by known target-ids first, then fall back to finding any expanded
 * engagement panel that actually contains transcript timestamps.
 */
function findTranscriptPanel() {
  const KNOWN_IDS = ["PAmodern_transcript_view", "engagement-panel-searchable-transcript"];

  // Check known transcript panel target-ids
  for (const id of KNOWN_IDS) {
    const panel = document.querySelector(
      `ytd-engagement-panel-section-list-renderer[target-id="${id}"][visibility="ENGAGEMENT_PANEL_VISIBILITY_EXPANDED"]`
    );
    if (panel) return panel;
  }

  // Fallback: find any expanded engagement panel that contains transcript segments
  const expandedPanels = document.querySelectorAll(
    'ytd-engagement-panel-section-list-renderer[visibility="ENGAGEMENT_PANEL_VISIBILITY_EXPANDED"]'
  );
  for (const panel of expandedPanels) {
    if (
      panel.querySelector(".ytwTranscriptSegmentViewModelTimestamp") ||
      panel.querySelector("ytd-transcript-segment-renderer")
    ) {
      return panel;
    }
  }

  // Legacy layout
  const legacy = document.querySelector("ytd-transcript-renderer");
  if (legacy) return legacy;

  return null;
}

/**
 * Attempt to open the transcript panel by:
 * 1. Expanding the video description (if collapsed)
 * 2. Clicking "Show transcript" button
 * 3. Waiting for the transcript renderer to appear
 */
async function openTranscriptPanel() {
  // Step 1: Expand description if collapsed
  await expandDescription();

  // Step 2: Find and click "Show transcript" button
  const transcriptBtn = findShowTranscriptButton();
  if (!transcriptBtn) {
    throw new Error(
      "No 'Show transcript' button found. This video may not have a transcript."
    );
  }

  transcriptBtn.click();

  // Step 3: Wait for the transcript panel to appear
  await waitForTranscriptPanel(8000);
}

/**
 * Expand the video description if it's collapsed.
 */
async function expandDescription() {
  // Look for the "...more" expand button
  const expandBtn = document.querySelector(
    "tp-yt-paper-button#expand"
  );
  if (expandBtn) {
    expandBtn.click();
    await sleep(500);
  }
}

/**
 * Find the "Show transcript" button.
 * YouTube doesn't always use consistent selectors, so we search broadly.
 * Supports English ("Show transcript") and Chinese ("内容转文字").
 */
function findShowTranscriptButton() {
  const TRANSCRIPT_LABELS = ["show transcript", "内容转文字"];

  function matchesLabel(text) {
    const lower = text.trim().toLowerCase();
    return TRANSCRIPT_LABELS.some((label) => lower.includes(label));
  }

  function exactMatchesLabel(text) {
    const lower = text.trim().toLowerCase();
    return TRANSCRIPT_LABELS.some((label) => lower === label);
  }

  // Strategy 1: aria-label
  const byAria = document.querySelector(
    'button[aria-label="Show transcript"]'
  );
  if (byAria) return byAria;

  // Strategy 2: Look in description section for buttons with transcript text
  const allButtons = document.querySelectorAll(
    "ytd-video-description-transcript-section-renderer button"
  );
  for (const btn of allButtons) {
    if (matchesLabel(btn.textContent)) {
      return btn;
    }
  }

  // Strategy 3: Broader search across the description area
  const descriptionButtons = document.querySelectorAll(
    "ytd-watch-metadata button, #description button, #structured-description button"
  );
  for (const btn of descriptionButtons) {
    if (matchesLabel(btn.textContent)) {
      return btn;
    }
  }

  // Strategy 4: Widest search — any button on the page (exact match only)
  const pageButtons = document.querySelectorAll("button");
  for (const btn of pageButtons) {
    if (exactMatchesLabel(btn.textContent)) {
      return btn;
    }
  }

  return null;
}

/**
 * Scrape all transcript segments into a formatted string.
 * Format: "0:15 Hello everyone welcome to..."
 *
 * Supports both modern and legacy YouTube transcript layouts.
 */
function scrapeTranscriptSegments(includeTimestamps) {
  // Modern layout: timestamps use .ytwTranscriptSegmentViewModelTimestamp,
  // text uses span.ytAttributedStringHost
  const panel = findTranscriptPanel();
  if (!panel) return null;

  // --- Modern layout ---
  const timestamps = panel.querySelectorAll(
    ".ytwTranscriptSegmentViewModelTimestamp"
  );
  if (timestamps.length > 0) {
    const lines = [];
    for (const tsEl of timestamps) {
      // The segment container is the parent <transcript-segment-view-model> element
      // that holds both the timestamp and the text span.
      const segment = tsEl.closest("transcript-segment-view-model") || tsEl.parentElement;
      const textEl = segment.querySelector(
        "span.ytAttributedStringHost"
      );

      const timestamp = tsEl.textContent.trim();
      const text = textEl ? textEl.textContent.trim() : "";

      if (text) {
        lines.push(includeTimestamps && timestamp ? `${timestamp} ${text}` : text);
      }
    }
    if (lines.length > 0) return lines.join("\n");
  }

  // --- Legacy layout ---
  const segments = panel.querySelectorAll(
    "ytd-transcript-segment-renderer"
  );
  if (segments.length > 0) {
    const lines = [];
    for (const segment of segments) {
      const timestampEl = segment.querySelector(".segment-timestamp");
      const textEl = segment.querySelector(".segment-text");

      const timestamp = timestampEl ? timestampEl.textContent.trim() : "";
      const text = textEl ? textEl.textContent.trim() : "";

      if (text) {
        lines.push(includeTimestamps && timestamp ? `${timestamp} ${text}` : text);
      }
    }
    if (lines.length > 0) return lines.join("\n");
  }

  return null;
}

/**
 * Wait for the transcript panel to appear in the DOM.
 */
function waitForTranscriptPanel(timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    if (findTranscriptPanel()) {
      resolve(findTranscriptPanel());
      return;
    }

    const observer = new MutationObserver(() => {
      const el = findTranscriptPanel();
      if (el) {
        observer.disconnect();
        clearTimeout(timer);
        resolve(el);
      }
    });

    const timer = setTimeout(() => {
      observer.disconnect();
      reject(
        new Error("Timed out waiting for transcript panel to load.")
      );
    }, timeoutMs);

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["visibility"],
    });
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
