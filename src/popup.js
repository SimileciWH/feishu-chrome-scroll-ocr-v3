const statusEl = document.getElementById('status');
const apiKeyEl = document.getElementById('apiKey');
const languageModeEl = document.getElementById('languageMode');
const regionSizeEl = document.getElementById('regionSize');
const downloadFolderModeEl = document.getElementById('downloadFolderMode');
const downloadFolderEl = document.getElementById('downloadFolder');
const applyFolderBtn = document.getElementById('applyFolder');
const autoDownloadEl = document.getElementById('autoDownload');
const saveBtn = document.getElementById('save');
const pickBtn = document.getElementById('pick');
const runBtn = document.getElementById('run');
const copyBtn = document.getElementById('copy');
const downloadBtn = document.getElementById('download');
const infoEl = document.getElementById('info');
const queueStatsEl = document.getElementById('queueStats');
const batchPanelEl = document.getElementById('batchPanel');
const batchHintEl = document.getElementById('batchHint');
const tabListEl = document.getElementById('tabList');
const selectAllTabsBtn = document.getElementById('selectAllTabs');
const clearTabsBtn = document.getElementById('clearTabs');
const cancelBatchBtn = document.getElementById('cancelBatch');
const startBatchBtn = document.getElementById('startBatch');
let batchRefreshTimer = null;
let batchSelectedTabIds = null; // null => default select all ready tabs
let batchRefreshing = false;
let queueStatePolling = null;
const DOWNLOAD_FOLDER_PRESETS = ['', 'FeishuOCR', 'Documents/FeishuOCR', 'Desktop/FeishuOCR'];

function setStatus(text, isError = false) {
  if (!statusEl) return;
  statusEl.textContent = text;
  statusEl.style.color = isError ? '#b00020' : '#666';
}

function setInfo(text) {
  if (!infoEl) return;
  infoEl.textContent = text;
}

function setQueueStats(text) {
  if (!queueStatsEl) return;
  queueStatsEl.textContent = text;
}

async function refreshQueueStats() {
  try {
    const resp = await chrome.runtime.sendMessage({ type: 'GET_BATCH_QUEUE_STATE' });
    const state = resp?.ok ? resp.state : null;
    if (!state) {
      setQueueStats('Queue: idle');
      return;
    }
    const total = Number(state.total || 0);
    const done = Number(state.done || 0);
    const success = Number(state.success || 0);
    const failed = Number(state.failed || 0);
    const status = String(state.status || 'idle');
    if (status === 'running') {
      setQueueStats(`Queue: total ${total} • done ${done} • success ${success} • failed ${failed}`);
      return;
    }
    if (status === 'done' || status === 'done_with_errors') {
      setQueueStats(`Queue: total ${total} • done ${done} • success ${success} • failed ${failed}`);
      return;
    }
    if (status === 'error') {
      setQueueStats(`Queue: error • total ${total} • failed ${failed}`);
      return;
    }
    setQueueStats('Queue: idle');
  } catch (_) {
    setQueueStats('Queue: idle');
  }
}

function startQueueStatsPolling() {
  if (queueStatePolling) clearInterval(queueStatePolling);
  refreshQueueStats();
  queueStatePolling = setInterval(() => {
    refreshQueueStats();
  }, 1000);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseRegionSize(raw) {
  const value = String(raw || '').trim();
  const m = value.match(/^(\d+)\s*[x×]\s*(\d+)$/i);
  if (!m) return null;
  const width = Math.max(100, parseInt(m[1], 10));
  const height = Math.max(50, parseInt(m[2], 10));
  return { width, height };
}

function normalizeDownloadFolder(raw) {
  return String(raw || '')
    .replace(/\\/g, '/')
    .replace(/^\/*/, '')
    .replace(/\.\./g, '')
    .replace(/\/+/g, '/')
    .replace(/^\/+|\/+$/g, '')
    .trim();
}

function isPresetDownloadFolder(folder) {
  return DOWNLOAD_FOLDER_PRESETS.includes(folder);
}

function setDownloadFolderUi(folderRaw) {
  const hasValue = folderRaw !== undefined && folderRaw !== null;
  const folder = normalizeDownloadFolder(hasValue ? folderRaw : 'FeishuOCR');
  if (isPresetDownloadFolder(folder)) {
    downloadFolderModeEl.value = folder;
    downloadFolderEl.value = '';
    downloadFolderEl.style.display = 'none';
    return;
  }
  downloadFolderModeEl.value = 'custom';
  downloadFolderEl.value = folder;
  downloadFolderEl.style.display = 'block';
}

function resolveDownloadFolderSetting() {
  const mode = String(downloadFolderModeEl.value || '');
  if (mode === 'custom') {
    const custom = normalizeDownloadFolder(downloadFolderEl.value);
    if (!custom) throw new Error('Custom download folder cannot be empty');
    return custom;
  }
  return normalizeDownloadFolder(mode);
}

function sanitizeDownloadFilename(name) {
  const base = String(name || '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/[\\/:*?"<>|]/g, ' ')
    .replace(/[^\p{L}\p{N}\p{Script=Han}\s._()-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[.\s]+|[.\s]+$/g, '')
    .slice(0, 64);
  if (!base) return `feishu-extract-${new Date().toISOString().replace(/[:.]/g, '-')}.txt`;
  return base.toLowerCase().endsWith('.txt') ? base : `${base}.txt`;
}

function buildDownloadPath(filename, folder) {
  const safeFilename = sanitizeDownloadFilename(String(filename || '').split('/').pop());
  const dir = normalizeDownloadFolder(folder);
  if (!dir) return safeFilename;
  const safeDir = dir
    .split('/')
    .map((part) => part.replace(/[\\/:*?"<>|]/g, '').trim())
    .filter(Boolean)
    .join('/');
  return safeDir ? `${safeDir}/${safeFilename}` : safeFilename;
}

function formatExtractInfo(extractedAt, text) {
  if (!extractedAt || !text) return 'No extraction yet';
  const d = new Date(extractedAt);
  const time = Number.isNaN(d.getTime()) ? 'unknown time' : d.toLocaleString();
  return `Last extraction: ${time} • ${text.length} chars`;
}

function getExtractStorageKeys(tabId) {
  const suffix = Number.isFinite(tabId) ? `_${tabId}` : '';
  return {
    progress: `extractProgress${suffix}`,
    text: `extractedText${suffix}`,
    meta: `extractedMeta${suffix}`,
    at: `extractedAt${suffix}`,
    filename: `extractedFilename${suffix}`
  };
}

function createRunId(tabId) {
  return `${Date.now()}_${tabId}_${Math.random().toString(36).slice(2, 8)}`;
}

function readScopedExtract(result, tabId) {
  const keys = getExtractStorageKeys(tabId);
  return {
    extractProgress: result[keys.progress] || null,
    extractedText: result[keys.text] || '',
    extractedMeta: result[keys.meta] || null,
    extractedAt: result[keys.at] || null,
    extractedFilename: result[keys.filename] || null
  };
}

function ensureRequiredElements() {
  const missing = [];
  if (!statusEl) missing.push('status');
  if (!apiKeyEl) missing.push('apiKey');
  if (!languageModeEl) missing.push('languageMode');
  if (!regionSizeEl) missing.push('regionSize');
  if (!downloadFolderModeEl) missing.push('downloadFolderMode');
  if (!downloadFolderEl) missing.push('downloadFolder');
  if (!applyFolderBtn) missing.push('applyFolder');
  if (!autoDownloadEl) missing.push('autoDownload');
  if (!saveBtn) missing.push('save');
  if (!pickBtn) missing.push('pick');
  if (!runBtn) missing.push('run');
  if (!copyBtn) missing.push('copy');
  if (!downloadBtn) missing.push('download');
  if (!infoEl) missing.push('info');
  if (!queueStatsEl) missing.push('queueStats');
  if (!batchPanelEl) missing.push('batchPanel');
  if (!batchHintEl) missing.push('batchHint');
  if (!tabListEl) missing.push('tabList');
  if (!selectAllTabsBtn) missing.push('selectAllTabs');
  if (!clearTabsBtn) missing.push('clearTabs');
  if (!cancelBatchBtn) missing.push('cancelBatch');
  if (!startBatchBtn) missing.push('startBatch');

  if (missing.length) {
    console.error('[popup] missing elements:', missing.join(','));
    if (statusEl) setStatus(`UI missing: ${missing.join(', ')}`, true);
    return false;
  }
  return true;
}

async function safeSendMessage(tabId, payload, timeoutMs = 5000) {
  try {
    const res = await Promise.race([
      chrome.tabs.sendMessage(tabId, payload),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), timeoutMs))
    ]);
    return { ok: true, res };
  } catch (e) {
    const msg = String(e?.message || e);
    // Handle "receiving end does not exist" explicitly
    if (msg.includes('receiving end does not exist') || msg.includes('Could not establish connection')) {
      return { ok: false, error: 'Content script not loaded. Try reloading the page or the extension.' };
    }
    if (msg.includes('Timeout') || msg.includes('timeout')) {
      return { ok: false, error: 'Connection timeout. Check if content script is loaded.' };
    }
    return { ok: false, error: msg };
  }
}

async function injectContentScript(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['src/content.js']
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
}

async function ensureContentScriptReady(tab) {
  const firstPing = await safeSendMessage(tab.id, { type: 'PING', windowId: tab.windowId });
  if (firstPing.ok) return { ok: true };

  const injected = await injectContentScript(tab.id);
  if (!injected.ok) {
    return { ok: false, error: `Inject failed: ${injected.error}` };
  }

  const secondPing = await safeSendMessage(tab.id, { type: 'PING', windowId: tab.windowId });
  if (secondPing.ok) return { ok: true };
  return { ok: false, error: secondPing.error || 'Content script still not ready after inject.' };
}

async function getActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tab = tabs?.[0];
  if (!tab?.id) {
    throw new Error('No active tab found. Please open a Feishu page.');
  }
  return tab;
}

function isFeishuUrl(url) {
  const u = String(url || '');
  return u.includes('feishu.cn') || u.includes('docs.feishu.cn');
}

function showBatchPanel(show) {
  if (!batchPanelEl) return;
  batchPanelEl.style.display = show ? 'block' : 'none';
}

function renderBatchList(items, selectedSet) {
  tabListEl.innerHTML = '';
  if (!items.length) {
    tabListEl.innerHTML = '<div class="tab-item disabled"><span class="tab-title">No Feishu tabs in this window</span></div>';
    return;
  }
  for (const item of items) {
    const row = document.createElement('label');
    row.className = `tab-item ${item.canRun ? '' : 'disabled'}`;
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.dataset.tabId = String(item.tab.id);
    checkbox.disabled = !item.canRun;
    checkbox.checked = !!(item.canRun && selectedSet?.has(item.tab.id));
    checkbox.onchange = () => {
      if (!(batchSelectedTabIds instanceof Set)) batchSelectedTabIds = new Set();
      if (checkbox.checked) batchSelectedTabIds.add(item.tab.id);
      else batchSelectedTabIds.delete(item.tab.id);
    };
    const title = document.createElement('span');
    title.className = 'tab-title';
    title.textContent = item.title || item.tab.title || `Tab ${item.tab.id}`;
    const badge = document.createElement('span');
    badge.className = 'tab-badge';
    badge.textContent = item.hasRegion ? 'region' : (item.canRun ? 'default' : 'no region');
    row.appendChild(checkbox);
    row.appendChild(title);
    row.appendChild(badge);
    tabListEl.appendChild(row);
  }
}

function getSelectedBatchTabIds() {
  return [...tabListEl.querySelectorAll('input[type="checkbox"]')]
    .filter((el) => el.checked && !el.disabled)
    .map((el) => parseInt(el.dataset.tabId, 10))
    .filter(Number.isFinite);
}

async function queryBatchCandidates() {
  const { defaultRegionRect } = await chrome.storage.local.get(['defaultRegionRect']);
  const hasDefaultRegion = !!(defaultRegionRect && defaultRegionRect.width && defaultRegionRect.height);
  const tabs = await chrome.tabs.query({ currentWindow: true });
  const feishuTabs = tabs.filter((t) => t.id && isFeishuUrl(t.url));
  const out = [];
  for (const tab of feishuTabs) {
    const ping = await ensureContentScriptReady(tab);
    if (!ping.ok) {
      out.push({ tab, hasRegion: false, canRun: hasDefaultRegion, title: tab.title || '' });
      continue;
    }
    const state = await safeSendMessage(tab.id, { type: 'GET_REGION_STATE', tabId: tab.id }, 3000);
    const res = state.ok ? (state.res || state) : null;
    const hasRegion = !!res?.hasRegion;
    out.push({
      tab,
      hasRegion,
      canRun: hasRegion || hasDefaultRegion,
      title: res?.title || tab.title || ''
    });
  }
  return out;
}

async function refreshBatchCandidates() {
  if (batchRefreshing) return;
  batchRefreshing = true;
  try {
    const items = await queryBatchCandidates();
    const readyIds = new Set(items.filter((x) => x.canRun).map((x) => x.tab.id));
    if (!(batchSelectedTabIds instanceof Set)) {
      batchSelectedTabIds = new Set(readyIds);
    } else {
      batchSelectedTabIds = new Set([...batchSelectedTabIds].filter((id) => readyIds.has(id)));
    }
    const readyCount = readyIds.size;
    const regionCount = items.filter((x) => x.hasRegion).length;
    const selectedCount = [...batchSelectedTabIds].filter((id) => readyIds.has(id)).length;
    batchHintEl.textContent = readyCount
      ? `${readyCount} ready (${regionCount} region + ${Math.max(0, readyCount - regionCount)} default) • ${selectedCount} selected (live)`
      : 'No tab has selected/default region yet.';
    renderBatchList(items, batchSelectedTabIds);
  } finally {
    batchRefreshing = false;
  }
}

function startBatchRefresh() {
  if (batchRefreshTimer) clearInterval(batchRefreshTimer);
  refreshBatchCandidates();
  batchRefreshTimer = setInterval(() => {
    refreshBatchCandidates();
  }, 1500);
}

function stopBatchRefresh() {
  if (batchRefreshTimer) {
    clearInterval(batchRefreshTimer);
    batchRefreshTimer = null;
  }
}

async function waitForExtractionDone(tabId, runId, timeoutMs = 8 * 60 * 1000) {
  const keys = getExtractStorageKeys(tabId);
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const result = await chrome.storage.local.get([keys.progress]);
    const p = result[keys.progress];
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

async function runBatchQueue(tabIds) {
  if (!tabIds.length) {
    setStatus('No tabs selected', true);
    return;
  }
  showBatchPanel(false);
  setQueueStats(`Queue: total ${tabIds.length} • done 0 • success 0 • failed 0`);
  const { defaultRegionRect } = await chrome.storage.local.get(['defaultRegionRect']);
  const hasDefaultRegion = !!(defaultRegionRect && defaultRegionRect.width && defaultRegionRect.height);
  let done = 0;
  let failed = 0;
  let processed = 0;
  for (let i = 0; i < tabIds.length; i += 1) {
    const tabId = tabIds[i];
    try {
      const tab = await chrome.tabs.get(tabId);
      if (!tab?.id) {
        failed += 1;
        processed += 1;
        setQueueStats(`Queue: total ${tabIds.length} • done ${processed} • success ${done} • failed ${failed}`);
        continue;
      }
      await chrome.tabs.update(tab.id, { active: true });
      await sleep(260);
      setStatus(`[${i + 1}/${tabIds.length}] Capture: ${tab.title || tabId}`);
      setInfo(`Queue running... ${done + failed}/${tabIds.length} finished`);

      const ping = await ensureContentScriptReady(tab);
      if (!ping.ok) {
        failed += 1;
        processed += 1;
        setQueueStats(`Queue: total ${tabIds.length} • done ${processed} • success ${done} • failed ${failed}`);
        continue;
      }
      // Re-check region state right before dispatch to avoid stale selections.
      const regionState = await safeSendMessage(tab.id, { type: 'GET_REGION_STATE', tabId: tab.id }, 3000);
      const rs = regionState.ok ? (regionState.res || regionState) : null;
      if (!rs?.hasRegion && !hasDefaultRegion) {
        failed += 1;
        processed += 1;
        setQueueStats(`Queue: total ${tabIds.length} • done ${processed} • success ${done} • failed ${failed}`);
        continue;
      }
      const runId = createRunId(tab.id);
      const keys = getExtractStorageKeys(tab.id);
      await chrome.storage.local.set({
        [keys.progress]: { progress: 'queued', runId, iteration: 0, message: 'queued' }
      });

      const started = await safeSendMessage(
        tab.id,
        { type: 'RUN_CAPTURE_EXTRACT', windowId: tab.windowId, tabId: tab.id, runId },
        5000
      );
      if (!started.ok && !String(started.error || '').toLowerCase().includes('timeout')) {
        failed += 1;
        processed += 1;
        setQueueStats(`Queue: total ${tabIds.length} • done ${processed} • success ${done} • failed ${failed}`);
        continue;
      }
      const waitResult = await waitForExtractionDone(tab.id, runId);
      if (!waitResult.ok) {
        failed += 1;
      } else {
        done += 1;
      }
      processed += 1;
      setQueueStats(`Queue: total ${tabIds.length} • done ${processed} • success ${done} • failed ${failed}`);
    } catch (_) {
      failed += 1;
      processed += 1;
      setQueueStats(`Queue: total ${tabIds.length} • done ${processed} • success ${done} • failed ${failed}`);
    }
  }
  if (failed) setStatus(`Batch done: ${done} success, ${failed} failed`, true);
  else setStatus(`Batch done: ${done} success`);
  setInfo(`Queue complete • ${done}/${tabIds.length} succeeded`);
  setQueueStats(`Queue: total ${tabIds.length} • done ${processed} • success ${done} • failed ${failed}`);
}

async function sendToActiveTab(type, extraPayload = {}) {
  try {
    setStatus('Starting extraction...');
    const tab = await getActiveTab();
    const windowId = tab.windowId;

    // Check if URL is supported
    const url = tab.url || '';
    const supported = url.includes('feishu.cn') || url.includes('docs.feishu.cn');
    if (!supported) {
      setStatus('Only works on Feishu pages', true);
      return;
    }

    const ping = await ensureContentScriptReady(tab);
    if (!ping.ok) {
      const errMsg = (ping.error && ping.error.message) ? ping.error.message : String(ping.error || 'Connection failed');
      setStatus('Content script not ready: ' + errMsg, true);
      return;
    }

    // For RUN_CAPTURE_EXTRACT, use longer timeout (60s) since extraction takes time
    const isExtraction = type === 'RUN_CAPTURE_EXTRACT';
    const timeoutMs = isExtraction ? 60000 : 5000;
    
    const sent = await safeSendMessage(tab.id, { type, windowId, tabId: tab.id, ...extraPayload }, timeoutMs);
    if (!sent.ok) {
      // For extraction, don't treat timeout as error - it's likely still running
      if (isExtraction && sent.error.includes('timeout')) {
        setStatus('Extraction started (may take a while)...');
        return;
      }
      const errMsg = (sent.error && sent.error.message) ? sent.error.message : String(sent.error || 'Send failed');
      setStatus('Send failed: ' + errMsg, true);
      return;
    }

    setStatus(type === 'START_PICK_REGION' ? 'Region mode started' : 'Capture started');
    // For extraction, keep popup open and poll for progress
    if (isExtraction) {
      setStatus('Extraction started, waiting...');
      pollProgress(tab.id);
    } else {
      setTimeout(() => window.close(), 800);
    }
  } catch (err) {
    console.error('[popup] sendToActiveTab error:', err);
    const errMsg = (err && err.message) ? err.message : (err ? String(err) : 'Unknown error');
    setStatus('Error: ' + errMsg, true);
  }
}

// Poll storage for extraction progress
let progressPolling = null;
function pollProgress(tabId) {
  if (progressPolling) clearInterval(progressPolling);
  const keys = getExtractStorageKeys(tabId);
  
  progressPolling = setInterval(async () => {
    try {
      const result = await chrome.storage.local.get([keys.progress, keys.text, keys.meta, keys.at]);
      const scoped = readScopedExtract(result, tabId);
      
      if (scoped.extractProgress) {
        const p = scoped.extractProgress;
        if (p.progress === 'scrolling') {
          setStatus(`正在滚动... (${p.iteration + 1})`);
          setInfo(`Extracting... iteration ${p.iteration + 1}`);
        } else if (p.progress === 'done') {
          const iter = Number.isFinite(p.iteration) ? `迭代 ${p.iteration}` : '';
          setStatus(`提取完成! ${iter} ${p.charCount ? `• ${p.charCount} 字符` : ''}`.trim());
          setInfo(`Done • ${p.charCount || 0} chars`);
          clearInterval(progressPolling);
          progressPolling = null;
        } else if (p.progress === 'starting') {
          setStatus('正在启动...');
          setInfo('Extraction starting...');
        }
      }
      
      // Also check if extraction is complete
      if (scoped.extractedText) {
        setInfo(formatExtractInfo(scoped.extractedAt, scoped.extractedText));
        clearInterval(progressPolling);
        progressPolling = null;
      }
    } catch (e) {
      console.error('[popup] poll progress error:', e);
    }
  }, 1000);
  
  // Stop polling after 2 minutes
  setTimeout(() => {
    if (progressPolling) {
      clearInterval(progressPolling);
      progressPolling = null;
      setStatus('提取超时 (2分钟)');
    }
  }, 120000);
}

async function bootstrap() {
  if (!ensureRequiredElements()) return;

  try {
    const activeTab = await getActiveTab();
    const scopedKeys = getExtractStorageKeys(activeTab.id);
    const result = await chrome.storage.local.get([
      'ocrApiKey', 'languageMode', 'defaultRegionSize', 'autoDownload', 'downloadFolder',
      scopedKeys.text, scopedKeys.at, scopedKeys.progress, scopedKeys.meta
    ]);
    const { ocrApiKey, languageMode, defaultRegionSize, autoDownload, downloadFolder } = result;
    const { extractedText, extractedAt, extractProgress } = readScopedExtract(result, activeTab.id);
    apiKeyEl.value = ocrApiKey || 'helloworld';
    languageModeEl.value = languageMode || 'auto';
    if (defaultRegionSize?.width && defaultRegionSize?.height) {
      regionSizeEl.value = `${defaultRegionSize.width}x${defaultRegionSize.height}`;
    } else {
      regionSizeEl.value = '800x600';
    }
    setDownloadFolderUi(downloadFolder);
    autoDownloadEl.checked = autoDownload !== false;
    if (extractProgress?.progress === 'scrolling') {
      setInfo(`Extracting... iteration ${(extractProgress.iteration || 0) + 1}`);
      pollProgress(activeTab.id);
    } else {
      setInfo(formatExtractInfo(extractedAt, extractedText));
    }
  } catch (e) {
    console.error('[popup] storage get failed:', e);
    setStatus(`Storage read error: ${String(e?.message || e)}`, true);
  }
  startQueueStatsPolling();

  saveBtn.onclick = async () => {
    try {
      const parsedSize = parseRegionSize(regionSizeEl.value);
      if (!parsedSize) {
        setStatus('Invalid region size. Use format: 800x600', true);
        return;
      }
      regionSizeEl.value = `${parsedSize.width}x${parsedSize.height}`;
      const folder = resolveDownloadFolderSetting();
      setDownloadFolderUi(folder);
      const { pendingRegionRect, defaultRegionRect } = await chrome.storage.local.get(['pendingRegionRect', 'defaultRegionRect']);
      await chrome.storage.local.set({
        ocrApiKey: (apiKeyEl.value || '').trim(),
        languageMode: languageModeEl.value || 'auto',
        defaultRegionSize: parsedSize,
        defaultRegionRect: pendingRegionRect || defaultRegionRect || null,
        autoDownload: !!autoDownloadEl.checked,
        downloadFolder: folder
      });
      setStatus('Settings saved');
    } catch (e) {
      console.error('[popup] storage set failed:', e);
      setStatus(`Save failed: ${String(e?.message || e)}`, true);
    }
  };

  downloadFolderModeEl.onchange = () => {
    if (downloadFolderModeEl.value === 'custom') {
      downloadFolderEl.style.display = 'block';
      if (!downloadFolderEl.value) downloadFolderEl.value = 'FeishuOCR';
      downloadFolderEl.focus();
    } else {
      downloadFolderEl.style.display = 'none';
    }
  };

  applyFolderBtn.onclick = () => {
    try {
      const folder = resolveDownloadFolderSetting();
      setDownloadFolderUi(folder);
      setStatus(`Folder ready: ${folder || 'Downloads root'}`);
    } catch (e) {
      setStatus(`Folder invalid: ${String(e?.message || e)}`, true);
    }
  };

  pickBtn.onclick = async () => {
    const parsedSize = parseRegionSize(regionSizeEl.value);
    if (!parsedSize) {
      setStatus('Invalid region size. Use format: 800x600', true);
      return;
    }
    regionSizeEl.value = `${parsedSize.width}x${parsedSize.height}`;
    const { defaultRegionRect } = await chrome.storage.local.get(['defaultRegionRect']);
    sendToActiveTab('START_PICK_REGION', { defaultRegionSize: parsedSize, defaultRegionRect });
  };
  runBtn.onclick = async () => {
    showBatchPanel(true);
    batchSelectedTabIds = null;
    batchHintEl.textContent = 'Loading tabs...';
    tabListEl.innerHTML = '<div class="tab-item disabled"><span class="tab-title">Scanning...</span></div>';
    startBatchRefresh();
  };

  selectAllTabsBtn.onclick = () => {
    const enabledIds = [...tabListEl.querySelectorAll('input[type="checkbox"]')]
      .filter((el) => !el.disabled)
      .map((el) => parseInt(el.dataset.tabId, 10))
      .filter(Number.isFinite);
    batchSelectedTabIds = new Set(enabledIds);
    refreshBatchCandidates();
  };

  clearTabsBtn.onclick = () => {
    batchSelectedTabIds = new Set();
    refreshBatchCandidates();
  };

  cancelBatchBtn.onclick = () => {
    stopBatchRefresh();
    showBatchPanel(false);
  };

  startBatchBtn.onclick = async () => {
    stopBatchRefresh();
    const ids = getSelectedBatchTabIds();
    if (!ids.length) {
      setStatus('No tabs selected', true);
      return;
    }
    const started = await chrome.runtime.sendMessage({ type: 'START_BATCH_QUEUE', tabIds: ids });
    if (!started?.ok) {
      setStatus(`Queue start failed: ${started?.error || 'unknown error'}`, true);
      return;
    }
    showBatchPanel(false);
    setStatus(`Queue started: ${ids.length} tabs`);
    refreshQueueStats();
  };

  // Copy to clipboard
  copyBtn.onclick = async () => {
    try {
      setStatus('Getting extracted text...');
      const tab = await getActiveTab();
      const result = await safeSendMessage(tab.id, { type: 'GET_EXTRACTED_TEXT', tabId: tab.id });
      // Response is direct, not wrapped in res
      const text = result.ok ? (result.res?.text || result.text) : null;
      if (!text) {
        setStatus('No extraction found. Run extraction first.', true);
        return;
      }
      await navigator.clipboard.writeText(text);
      setStatus('Copied to clipboard!');
    } catch (e) {
      setStatus('Copy failed: ' + String(e?.message || e), true);
    }
  };

  // Download as .txt
  downloadBtn.onclick = async () => {
    try {
      setStatus('Preparing download...');
      const tab = await getActiveTab();
      const result = await safeSendMessage(tab.id, { type: 'GET_EXTRACTED_TEXT', tabId: tab.id });
      // Response is direct, not wrapped in res
      const text = result.ok ? (result.res?.text || result.text) : null;
      const savedFilename = result.ok ? (result.res?.filename || result.filename) : null;
      if (!text) {
        setStatus('No extraction found. Run extraction first.', true);
        return;
      }
      const settings = await chrome.storage.local.get(['downloadFolder']);
      const folder = normalizeDownloadFolder(
        settings.downloadFolder !== undefined && settings.downloadFolder !== null
          ? settings.downloadFolder
          : 'FeishuOCR'
      );
      const fallbackName = `feishu-extract-${new Date().toISOString().replace(/[:.]/g, '-')}.txt`;
      const outputPath = buildDownloadPath(savedFilename || fallbackName, folder);
      await chrome.runtime.sendMessage({ type: 'SAVE_TEXT', text, filename: outputPath, saveAs: false });
      setStatus(`Downloaded: ${outputPath}`);
    } catch (e) {
      setStatus('Download failed: ' + String(e?.message || e), true);
    }
  };
}

bootstrap();

// Listen for progress updates from content script
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === 'EXTRACT_PROGRESS') {
    const senderTabId = sender?.tab?.id;
    if (Number.isFinite(senderTabId)) {
      getActiveTab()
        .then((tab) => {
          if (tab.id !== senderTabId) return;
          if (msg.progress === 'starting') {
            setStatus('Starting extraction...');
            setInfo('Extraction starting...');
          } else if (msg.progress === 'scrolling') {
            setStatus(msg.message || 'Scrolling...');
            const it = Number.isFinite(msg.iteration) ? msg.iteration + 1 : null;
            setInfo(it ? `Extracting... iteration ${it}` : 'Extracting...');
          } else if (msg.progress === 'done') {
            setStatus('Extraction complete!');
            setInfo(`Done • ${msg.charCount || 0} chars`);
          }
        })
        .catch(() => {});
      return;
    }
    if (msg.progress === 'starting') {
      setStatus('Starting extraction...');
      setInfo('Extraction starting...');
    } else if (msg.progress === 'scrolling') {
      setStatus(msg.message || 'Scrolling...');
      const it = Number.isFinite(msg.iteration) ? msg.iteration + 1 : null;
      setInfo(it ? `Extracting... iteration ${it}` : 'Extracting...');
    } else if (msg.progress === 'done') {
      setStatus('Extraction complete!');
      setInfo(`Done • ${msg.charCount || 0} chars`);
    }
  }
});
