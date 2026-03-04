const statusEl = document.getElementById('status');
const apiKeyEl = document.getElementById('apiKey');
const saveBtn = document.getElementById('save');
const pickBtn = document.getElementById('pick');
const runBtn = document.getElementById('run');

function setStatus(text, isError = false) {
  if (!statusEl) return;
  statusEl.textContent = text;
  statusEl.style.color = isError ? '#b00020' : '#666';
}

function ensureRequiredElements() {
  const missing = [];
  if (!statusEl) missing.push('status');
  if (!apiKeyEl) missing.push('apiKey');
  if (!saveBtn) missing.push('save');
  if (!pickBtn) missing.push('pick');
  if (!runBtn) missing.push('run');

  if (missing.length) {
    console.error('[popup] missing elements:', missing.join(','));
    if (statusEl) setStatus(`UI missing: ${missing.join(', ')}`, true);
    return false;
  }
  return true;
}

async function safeSendMessage(tabId, payload) {
  try {
    const res = await chrome.tabs.sendMessage(tabId, payload);
    return { ok: true, res };
  } catch (e) {
    const msg = String(e?.message || e);
    // Handle "receiving end does not exist" explicitly
    if (msg.includes('receiving end does not exist') || msg.includes('Could not establish connection')) {
      return { ok: false, error: 'Content script not loaded. Try reloading the page or the extension.' };
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

    const sent = await safeSendMessage(tab.id, { type, windowId });
    if (!sent.ok) {
      const errMsg = (sent.error && sent.error.message) ? sent.error.message : String(sent.error || 'Send failed');
      setStatus('Send failed: ' + errMsg, true);
      return;
    }

    setStatus(type === 'START_PICK_REGION' ? 'Region mode started' : 'Capture task started');
    setTimeout(() => window.close(), 800);
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
}

bootstrap();
