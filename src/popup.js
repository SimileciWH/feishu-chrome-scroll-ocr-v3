const statusEl = document.getElementById('status');
const apiKeyEl = document.getElementById('apiKey');

function setStatus(text, isErr = false) {
  statusEl.textContent = text;
  statusEl.style.color = isErr ? '#b00020' : '#444';
}

chrome.storage.local.get(['ocrApiKey', 'lastProgress'], ({ ocrApiKey, lastProgress }) => {
  apiKeyEl.value = ocrApiKey || 'helloworld';
  if (lastProgress?.text) setStatus(`上次状态：${lastProgress.text}`);
});

document.getElementById('save').onclick = async () => {
  await chrome.storage.local.set({ ocrApiKey: apiKeyEl.value.trim() });
  setStatus('设置已保存');
};

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error('找不到当前标签页');
  return tab;
}

async function pingContent(tabId) {
  try {
    const res = await chrome.tabs.sendMessage(tabId, { type: 'PING' });
    if (!res?.ok) throw new Error(res?.error || 'PING未收到ACK');
    return res;
  } catch (e) {
    throw new Error(`注入/消息链失败：${String(e.message || e)}`);
  }
}

async function sendToContent(type) {
  const tab = await getActiveTab();
  await pingContent(tab.id);
  const res = await chrome.tabs.sendMessage(tab.id, { type });
  if (!res?.ok) throw new Error(res?.error || 'content未ACK');
  return res;
}

document.getElementById('pick').onclick = async () => {
  try {
    setStatus('准备选区...');
    const res = await sendToContent('START_PICK_REGION');
    setStatus(res.message || '选区模式已启动，请在页面拖拽框选');
  } catch (e) {
    setStatus(`错误：${e.message || e}`, true);
  }
};

document.getElementById('run').onclick = async () => {
  try {
    setStatus('准备中...');
    const res = await sendToContent('RUN_CAPTURE_EXTRACT');
    setStatus(res.message || '任务已开始，请保持页面前台');
    window.close();
  } catch (e) {
    setStatus(`错误：${e.message || e}`, true);
  }
};

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes.lastProgress) return;
  const np = changes.lastProgress.newValue;
  if (np?.text) setStatus(np.text, np.level === 'error');
});
