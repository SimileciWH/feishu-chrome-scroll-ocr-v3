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
    return { ok: false, error: msg };
  }
}

async function getActiveTabId() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tab = tabs?.[0];
  if (!tab?.id) throw new Error('No active tab');
  return tab.id;
}

async function sendToActiveTab(type) {
  try {
    setStatus('Sending command...');
    const tabId = await getActiveTabId();

    // ping first to make error visible instead of silent failure
    const ping = await safeSendMessage(tabId, { type: 'PING' });
    if (!ping.ok) {
      throw new Error(`Content script unavailable: ${ping.error}`);
    }

    const sent = await safeSendMessage(tabId, { type });
    if (!sent.ok) {
      throw new Error(`sendMessage failed: ${sent.error}`);
    }

    setStatus(type === 'START_PICK_REGION' ? 'Region mode started' : 'Capture task started');
    window.close();
  } catch (e) {
    console.error('[popup] sendToActiveTab error:', e);
    setStatus(`Error: ${String(e?.message || e)}`, true);
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
