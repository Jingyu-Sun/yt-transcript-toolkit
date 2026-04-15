# YT Transcript Copier

A browser extension that extracts a YouTube video's title and timestamped transcript, then either copies it to the clipboard or sends it directly to DeepSeek with a user-editable prompt.

## Features

- Copy the current YouTube video's title and transcript to the clipboard
- Edit the prompt used when sending title + transcript to DeepSeek
- Show popup labels and the default prompt in English by default, or Chinese when the browser locale starts with `zh`
- Persist the custom DeepSeek prompt with extension storage
- Works with both Chrome and Firefox
- Handles multiple YouTube transcript panel layouts and localized transcript buttons

## Project files

- [manifest.json](manifest.json): active manifest for the browser you are currently testing
- [manifest.chrome.json](manifest.chrome.json): saved Chrome manifest
- [manifest.firefox.json](manifest.firefox.json): saved Firefox manifest
- [popup.js](popup.js): popup UI logic, localization, and prompt persistence
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
3. Optionally edit the DeepSeek prompt in the popup
4. Choose one of the actions:
   - **Copy Title + Transcript**: copies the raw title and transcript only
   - **Send to DeepSeek**: sends the current prompt plus the title and transcript

## Notes

- The extension expects a YouTube watch page with an available transcript
- Firefox and Chrome use different background manifest settings, so [manifest.json](manifest.json) must match the browser you are loading
- The browser-specific manifests include `storage` permission so the custom DeepSeek prompt can persist
- All runtime files are shared; only the manifest variant changes between browsers

## Development

For deeper implementation details, browser behavior notes, and DOM assumptions, see [DESIGN.md](DESIGN.md).
