const BATCH_STATE_KEY = 'batchQueueState';
let batchQueueRunning = false;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getExtractStorageKeys(tabId) {
  const suffix = Number.isFinite(tabId) ? `_${tabId}` : '';
  return {
    progress: `extractProgress${suffix}`,
    at: `extractedAt${suffix}`
  };
}

function createRunId(tabId) {
  return `${Date.now()}_${tabId}_${Math.random().toString(36).slice(2, 8)}`;
}

async function safeSendMessage(tabId, payload, timeoutMs = 5000) {
  try {
    const res = await Promise.race([
      chrome.tabs.sendMessage(tabId, payload),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), timeoutMs))
    ]);
    return { ok: true, res };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
}

async function ensureContentScriptReady(tab) {
  const first = await safeSendMessage(tab.id, { type: 'PING', windowId: tab.windowId }, 2500);
  if (first.ok) return { ok: true };
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['src/content.js']
    });
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
  const second = await safeSendMessage(tab.id, { type: 'PING', windowId: tab.windowId }, 3000);
  if (second.ok) return { ok: true };
  return { ok: false, error: second.error || 'Content script not ready' };
}

async function waitForExtractionDone(tabId, runId, timeoutMs = 8 * 60 * 1000) {
  const keys = getExtractStorageKeys(tabId);
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const result = await chrome.storage.local.get([keys.progress]);
    const p = result[keys.progress];
    // Ignore stale terminal states from previous runs on the same tab.
    if (p?.runId && p.runId !== runId) {
      await sleep(1000);
      continue;
    }
    if (p?.progress === 'done') return { ok: true, charCount: p.charCount || 0 };
    if (p?.progress === 'error') return { ok: false, error: p.error || 'extract failed' };
    await sleep(1000);
  }
  return { ok: false, error: 'timeout' };
}

async function setBatchState(state) {
  await chrome.storage.local.set({ [BATCH_STATE_KEY]: state });
}

async function runBatchQueue(tabIds) {
  const total = Array.isArray(tabIds) ? tabIds.length : 0;
  let done = 0;
  let failed = 0;
  let processed = 0;

  await setBatchState({
    status: 'running',
    total,
    done: processed,
    success: done,
    failed,
    currentTabId: null,
    updatedAt: Date.now()
  });

  for (const tabId of tabIds) {
    let currentTabId = tabId;
    try {
      const tab = await chrome.tabs.get(tabId);
      if (!tab?.id) throw new Error('tab not found');
      currentTabId = tab.id;

      await setBatchState({
        status: 'running',
        total,
        done: processed,
        success: done,
        failed,
        currentTabId,
        updatedAt: Date.now()
      });

      await chrome.tabs.update(tab.id, { active: true });
      await sleep(280);

      const ready = await ensureContentScriptReady(tab);
      if (!ready.ok) throw new Error(ready.error || 'content not ready');

      const runId = createRunId(tab.id);
      const keys = getExtractStorageKeys(tab.id);
      await chrome.storage.local.set({
        [keys.progress]: {
          progress: 'queued',
          runId,
          iteration: 0,
          message: 'queued'
        }
      });

      const started = await safeSendMessage(
        tab.id,
        { type: 'RUN_CAPTURE_EXTRACT', windowId: tab.windowId, tabId: tab.id, runId },
        5000
      );
      // Timeout can still mean content script has started. Verify by progress polling.
      if (!started.ok && !String(started.error || '').toLowerCase().includes('timeout')) {
        throw new Error(started.error || 'start failed');
      }

      const waitResult = await waitForExtractionDone(tab.id, runId);
      if (!waitResult.ok) throw new Error(waitResult.error || 'extract timeout');
      done += 1;
    } catch (_) {
      failed += 1;
    }
    processed += 1;
    await setBatchState({
      status: 'running',
      total,
      done: processed,
      success: done,
      failed,
      currentTabId,
      updatedAt: Date.now()
    });
  }

  await setBatchState({
    status: failed ? 'done_with_errors' : 'done',
    total,
    done: processed,
    success: done,
    failed,
    currentTabId: null,
    updatedAt: Date.now()
  });
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === 'CAPTURE_VISIBLE') {
    // captureVisibleTab already returns a data URL, pass it directly
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
      chrome.downloads.download({ url: reader.result, filename: msg.filename || 'feishu-extract.txt', saveAs: !!msg.saveAs })
        .then(() => sendResponse({ ok: true }))
        .catch((e) => sendResponse({ ok: false, error: String(e) }));
    };
    reader.onerror = () => sendResponse({ ok: false, error: 'Failed to read blob' });
    reader.readAsDataURL(blob);
    return true;
  }

  if (msg?.type === 'START_BATCH_QUEUE') {
    if (batchQueueRunning) {
      sendResponse({ ok: false, error: 'Queue already running' });
      return false;
    }
    const tabIds = Array.isArray(msg.tabIds) ? msg.tabIds.filter(Number.isFinite) : [];
    if (!tabIds.length) {
      sendResponse({ ok: false, error: 'No tabs selected' });
      return false;
    }
    batchQueueRunning = true;
    runBatchQueue(tabIds)
      .catch((e) => setBatchState({
        status: 'error',
        total: tabIds.length,
        done: 0,
        success: 0,
        failed: tabIds.length,
        currentTabId: null,
        error: String(e?.message || e),
        updatedAt: Date.now()
      }))
      .finally(() => { batchQueueRunning = false; });
    sendResponse({ ok: true, started: true, total: tabIds.length });
    return false;
  }

  if (msg?.type === 'GET_BATCH_QUEUE_STATE') {
    chrome.storage.local.get([BATCH_STATE_KEY])
      .then((result) => sendResponse({ ok: true, state: result[BATCH_STATE_KEY] || null }))
      .catch((e) => sendResponse({ ok: false, error: String(e?.message || e) }));
    return true;
  }

  return false;
});
