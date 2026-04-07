# Agent – Chrome Extension

Cursor-like agent chat in a full-height side panel. Click the extension icon to open the panel and chat.

## Load in Chrome

1. Open `chrome://extensions`
2. Turn on **Developer mode**
3. Click **Load unpacked**
4. Select the `agent` folder

## Usage

Click the extension icon in the toolbar. The **side panel** opens (full height of the window) with a chat UI: message list and an input at the bottom. Send messages with Enter; Shift+Enter for new line.

## What’s included

- **Side panel** (`sidepanel/`) – Full-height panel with header, scrollable messages, and a Cursor-style input at the bottom. Ready for you to plug in your own agent/API.
- **Background** (`background.js`) – Opens the side panel when you click the extension icon.
- **Content script** (`content/`) – Optional reading-time badge on pages (can be removed if you only want the agent UI).
# Agentify
# Agentify
