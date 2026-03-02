const statusEl = document.getElementById('status');
const apiKeyEl = document.getElementById('apiKey');

chrome.storage.local.get(['ocrApiKey'], ({ ocrApiKey }) => {
  apiKeyEl.value = ocrApiKey || 'helloworld';
});

document.getElementById('save').onclick = async () => {
  await chrome.storage.local.set({ ocrApiKey: apiKeyEl.value.trim() });
  statusEl.textContent = 'Settings saved';
};

async function sendToActiveTab(type) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  await chrome.tabs.sendMessage(tab.id, { type });
  window.close();
}

document.getElementById('pick').onclick = () => sendToActiveTab('START_PICK_REGION');
document.getElementById('run').onclick = () => sendToActiveTab('RUN_CAPTURE_EXTRACT');
