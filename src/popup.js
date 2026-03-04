const statusEl = document.getElementById('status');
const apiKeyEl = document.getElementById('apiKey');
const saveBtn = document.getElementById('save');
const pickBtn = document.getElementById('pick');
const runBtn = document.getElementById('run');
const copyBtn = document.getElementById('copy');
const downloadBtn = document.getElementById('download');
const infoEl = document.getElementById('info');

function setStatus(text, isError = false) {
  if (!statusEl) return;
  statusEl.textContent = text;
  statusEl.style.color = isError ? '#b00020' : '#666';
}

function setInfo(text) {
  if (!infoEl) return;
  infoEl.textContent = text;
}

function ensureRequiredElements() {
  const missing = [];
  if (!statusEl) missing.push('status');
  if (!apiKeyEl) missing.push('apiKey');
  if (!saveBtn) missing.push('save');
  if (!pickBtn) missing.push('pick');
  if (!runBtn) missing.push('run');
  if (!copyBtn) missing.push('copy');
  if (!downloadBtn) missing.push('download');
  if (!infoEl) missing.push('info');

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

async function getActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tab = tabs?.[0];
  if (!tab?.id) {
    throw new Error('No active tab found. Please open a Feishu page.');
  }
  return tab;
}

async function sendToActiveTab(type) {
  try {
    setStatus('Connecting...');
    const tab = await getActiveTab();
    const windowId = tab.windowId;

    // Check if URL is supported
    const url = tab.url || '';
    const supported = url.includes('feishu.cn') || url.includes('docs.feishu.cn');
    if (!supported) {
      setStatus('Only works on Feishu pages', true);
      return;
    }

    // ping first to make error visible instead of silent failure
    const ping = await safeSendMessage(tab.id, { type: 'PING', windowId });
    if (!ping.ok) {
      const errMsg = (ping.error && ping.error.message) ? ping.error.message : String(ping.error || 'Connection failed');
      setStatus('Content script not ready. Reload page + extension.', true);
      return;
    }

    // For RUN_CAPTURE_EXTRACT, use longer timeout (60s) since extraction takes time
    const isExtraction = type === 'RUN_CAPTURE_EXTRACT';
    const timeoutMs = isExtraction ? 60000 : 5000;
    
    const sent = await safeSendMessage(tab.id, { type, windowId }, timeoutMs);
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
    // Don't close window immediately for extraction - let it run
    if (!isExtraction) {
      setTimeout(() => window.close(), 800);
    }
  } catch (err) {
    console.error('[popup] sendToActiveTab error:', err);
    const errMsg = (err && err.message) ? err.message : (err ? String(err) : 'Unknown error');
    setStatus('Error: ' + errMsg, true);
  }
}

async function bootstrap() {
  if (!ensureRequiredElements()) return;

  try {
    const { ocrApiKey } = await chrome.storage.local.get(['ocrApiKey']);
    apiKeyEl.value = ocrApiKey || 'helloworld';
  } catch (e) {
    console.error('[popup] storage get failed:', e);
    setStatus(`Storage read error: ${String(e?.message || e)}`, true);
  }

  saveBtn.onclick = async () => {
    try {
      await chrome.storage.local.set({ ocrApiKey: (apiKeyEl.value || '').trim() });
      setStatus('Settings saved');
    } catch (e) {
      console.error('[popup] storage set failed:', e);
      setStatus(`Save failed: ${String(e?.message || e)}`, true);
    }
  };

  pickBtn.onclick = () => sendToActiveTab('START_PICK_REGION');
  runBtn.onclick = () => sendToActiveTab('RUN_CAPTURE_EXTRACT');

  // Copy to clipboard
  copyBtn.onclick = async () => {
    try {
      setStatus('Getting extracted text...');
      const tab = await getActiveTab();
      const result = await safeSendMessage(tab.id, { type: 'GET_EXTRACTED_TEXT' });
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
      const result = await safeSendMessage(tab.id, { type: 'GET_EXTRACTED_TEXT' });
      // Response is direct, not wrapped in res
      const text = result.ok ? (result.res?.text || result.text) : null;
      if (!text) {
        setStatus('No extraction found. Run extraction first.', true);
        return;
      }
      const blob = new Blob([text], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const filename = `feishu-extract-${new Date().toISOString().replace(/[:.]/g, '-')}.txt`;
      await chrome.downloads.download({ url, filename, saveAs: true });
      setStatus('Download started!');
    } catch (e) {
      setStatus('Download failed: ' + String(e?.message || e), true);
    }
  };
}

bootstrap();

// Listen for progress updates from content script
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === 'EXTRACT_PROGRESS') {
    if (msg.progress === 'starting') {
      setStatus('Starting extraction...');
    } else if (msg.progress === 'scrolling') {
      setStatus(msg.message || 'Scrolling...');
    } else if (msg.progress === 'done') {
      setStatus('Extraction complete!');
    }
  }
});
