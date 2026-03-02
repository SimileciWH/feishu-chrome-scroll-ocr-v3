chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    if (msg?.type === 'CAPTURE_VISIBLE') {
      const dataUrl = await chrome.tabs.captureVisibleTab(sender.tab.windowId, { format: 'png' });
      sendResponse({ ok: true, dataUrl });
    }
    if (msg?.type === 'SAVE_TEXT') {
      const blob = new Blob([msg.text || ''], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      await chrome.downloads.download({ url, filename: msg.filename || 'feishu-extract.txt', saveAs: true });
      sendResponse({ ok: true });
    }
  })().catch((e) => sendResponse({ ok: false, error: String(e) }));
  return true;
});
