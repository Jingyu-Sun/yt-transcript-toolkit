# YT Transcript Copier

A browser extension that extracts a YouTube video's title and timestamped transcript, then either copies it to the clipboard or sends it directly to DeepSeek for summarization.

## Features

- Copy the current YouTube video's title and transcript to the clipboard
- Send the current YouTube video's title and transcript to DeepSeek in a new tab
- Works with both Chrome and Firefox
- Handles multiple YouTube transcript panel layouts and localized transcript buttons

## Project files

- [manifest.json](manifest.json): active manifest for the browser you are currently testing
- [manifest.chrome.json](manifest.chrome.json): saved Chrome manifest
- [manifest.firefox.json](manifest.firefox.json): saved Firefox manifest
- [popup.js](popup.js): popup UI logic
- [content.js](content.js): YouTube transcript extraction logic
- [background.js](background.js): DeepSeek tab opening and injection logic
- [DESIGN.md](DESIGN.md): design notes and implementation details

## Browser setup

### Chrome

1. Make sure the Chrome manifest is the active root manifest:
   - copy or rename [manifest.chrome.json](manifest.chrome.json) to `manifest.json`
2. Open `chrome://extensions`
3. Enable **Developer mode**
4. Click **Load unpacked**
5. Select the project root folder

### Firefox

1. Make sure the Firefox manifest is the active root manifest:
   - copy or rename [manifest.firefox.json](manifest.firefox.json) to `manifest.json`
2. Open `about:debugging#/runtime/this-firefox`
3. Click **Load Temporary Add-on**
4. Select the root `manifest.json`

## Usage

1. Open a YouTube video page
2. Click the extension icon
3. Choose one of the actions:
   - **Copy Title + Transcript**
   - **Send to DeepSeek**

## Notes

- The extension expects a YouTube watch page with an available transcript
- Firefox and Chrome use different background manifest settings, so [manifest.json](manifest.json) must match the browser you are loading
- All runtime files are shared; only the manifest variant changes between browsers

## Development

For deeper implementation details, browser behavior notes, and DOM assumptions, see [DESIGN.md](DESIGN.md).
