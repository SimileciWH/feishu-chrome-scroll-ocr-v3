async function reportProgress(text, level = 'info', extra = {}) {
  const payload = { text, level, ts: new Date().toISOString(), ...extra };
  await chrome.storage.local.set({ lastProgress: payload });
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    if (msg?.type === 'CAPTURE_VISIBLE') {
      await reportProgress('滚动中：正在截图...');
      const dataUrl = await chrome.tabs.captureVisibleTab(sender.tab.windowId, { format: 'png' });
      return sendResponse({ ok: true, dataUrl });
    }

    if (msg?.type === 'SAVE_TEXT') {
      await reportProgress('识别中：正在保存TXT...');
      const blob = new Blob([msg.text || ''], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      await chrome.downloads.download({ url, filename: msg.filename || 'feishu-extract.txt', saveAs: true });
      await reportProgress('完成：TXT已保存');
      return sendResponse({ ok: true });
    }

    if (msg?.type === 'PROGRESS') {
      await reportProgress(msg.text || '处理中...', msg.level || 'info', msg.extra || {});
      return sendResponse({ ok: true });
    }

    return sendResponse({ ok: false, error: `unknown message: ${msg?.type}` });
  })().catch(async (e) => {
    await reportProgress(`错误：${String(e.message || e)}`, 'error');
    sendResponse({ ok: false, error: String(e.message || e) });
  });

  return true;
});
