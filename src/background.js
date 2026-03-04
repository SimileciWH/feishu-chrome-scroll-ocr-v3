chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === 'CAPTURE_VISIBLE') {
    const windowId = msg.windowId ?? sender.tab?.windowId;
    chrome.tabs.captureVisibleTab(windowId, { format: 'png' })
      .then((dataUrl) => sendResponse({ ok: true, dataUrl }))
      .catch((e) => sendResponse({ ok: false, error: String(e) }));
    return true;
  }

  if (msg?.type === 'SAVE_TEXT') {
    const blob = new Blob([msg.text || ''], { type: 'text/plain' });
    // Service workers don't have URL.createObjectURL, use FileReader instead
    const reader = new FileReader();
    reader.onload = () => {
      chrome.downloads.download({ url: reader.result, filename: msg.filename || 'feishu-extract.txt', saveAs: true })
        .then(() => sendResponse({ ok: true }))
        .catch((e) => sendResponse({ ok: false, error: String(e) }));
    };
    reader.onerror = () => sendResponse({ ok: false, error: 'Failed to read blob' });
    reader.readAsDataURL(blob);
    return true;
  }

  return false;
});
