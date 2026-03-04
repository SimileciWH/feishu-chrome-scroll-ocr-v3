let selectedRect = null;
let overlay = null;

const CONFIG = {
  scroll: {
    maxIterations: 140,
    minStep: 220,
    stepRatio: 0.82,
    maxStableRounds: 3,
  },
  wait: {
    idleMs: 450,
    stableMaxWaitMs: 2800,
    sampleEveryMs: 220,
    stableRounds: 3,
  },
  ocr: {
    endpoint: 'https://api.ocr.space/parse/image',
    retry: 2,
    lowConfidenceMinLen: 24,
    lowConfidenceAsciiRatio: 0.12,
  }
};

const Util = {
  sleep(ms) { return new Promise(r => setTimeout(r, ms)); },
  normalizeBlock(s) { return (s || '').replace(/\u200b/g, '').replace(/\s+/g, ' ').trim(); },
  nowIso() { return new Date().toISOString(); },
};

const UI = {
  makeOverlay() {
    const o = document.createElement('div');
    o.id = 'feishu-ocr-overlay';
    o.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:rgba(0,0,0,0.3)';
    document.body.appendChild(o);
    return o;
  },

  makeRegionBox(defaultW = 800, defaultH = 600) {
    const box = document.createElement('div');
    box.id = 'feishu-ocr-region-box';
    box.style.cssText = `
      position: fixed;
      border: 2px solid #ff0000;
      background: rgba(255, 0, 0, 0.1);
      z-index: 2147483647;
      overflow: hidden;
      min-width: 100px;
      min-height: 50px;
    `;
    // Center the box
    const centerX = (window.innerWidth - defaultW) / 2;
    const centerY = (window.innerHeight - defaultH) / 2;
    box.style.left = `${Math.max(0, centerX)}px`;
    box.style.top = `${Math.max(0, centerY)}px`;
    box.style.width = `${defaultW}px`;
    box.style.height = `${defaultH}px`;
    return box;
  },

  makeControlPanel(box) {
    const panel = document.createElement('div');
    panel.id = 'feishu-ocr-control-panel';
    panel.style.cssText = `
      position: fixed;
      z-index: 2147483648;
      background: white;
      padding: 10px;
      border-radius: 6px;
      box-shadow: 0 2px 10px rgba(0,0,0,0.3);
      font-family: Arial, sans-serif;
      font-size: 13px;
    `;
    panel.innerHTML = `
      <div style="margin-bottom:8px;font-weight:bold;color:#333;">📐 Region Size</div>
      <input type="text" id="feishu-ocr-size-input" placeholder="800x600" value="${box.style.width.replace('px','')}x${box.style.height.replace('px','')}"
        style="width:100px;padding:4px;border:1px solid #ccc;border-radius:4px;">
      <button id="feishu-ocr-confirm-btn" style="margin-left:8px;padding:4px 12px;background:#4f9fff;color:white;border:none;border-radius:4px;cursor:pointer;">Confirm</button>
      <button id="feishu-ocr-cancel-btn" style="margin-left:4px;padding:4px 12px;background:#ccc;color:#333;border:none;border-radius:4px;cursor:pointer;">Cancel</button>
      <div style="margin-top:8px;font-size:11px;color:#666;">Enter WxH to resize from center • Drag center to move</div>
    `;
    // Position panel below the box
    const boxRect = box.getBoundingClientRect();
    panel.style.left = `${boxRect.left}px`;
    panel.style.top = `${boxRect.bottom + 10}px`;
    return panel;
  },

  makeDraggable(box, panel) {
    let isDragging = false;
    let startX, startY, startLeft, startTop;

    // Drag to move
    box.addEventListener('mousedown', (e) => {
      if (e.target === box || e.target.style.cursor === 'move') {
        isDragging = true;
        startX = e.clientX;
        startY = e.clientY;
        startLeft = parseInt(box.style.left, 10);
        startTop = parseInt(box.style.top, 10);
        e.preventDefault();
      }
    });

    document.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      let newLeft = Math.max(0, Math.min(window.innerWidth - box.offsetWidth, startLeft + dx));
      let newTop = Math.max(0, Math.min(window.innerHeight - box.offsetHeight, startTop + dy));
      box.style.left = `${newLeft}px`;
      box.style.top = `${newTop}px`;
      // Update panel position
      panel.style.left = `${newLeft}px`;
      panel.style.top = `${newTop + box.offsetHeight + 10}px`;
    });

    document.addEventListener('mouseup', () => {
      isDragging = false;
    });
  },

  pickRegion() {
    if (overlay) overlay.remove();
    overlay = UI.makeOverlay();
    
    const defaultW = 800, defaultH = 600;
    const box = UI.makeRegionBox(defaultW, defaultH);
    overlay.appendChild(box);

    const panel = UI.makeControlPanel(box);
    document.body.appendChild(panel);
    UI.makeDraggable(box, panel);

    const sizeInput = document.getElementById('feishu-ocr-size-input');
    const confirmBtn = document.getElementById('feishu-ocr-confirm-btn');
    const cancelBtn = document.getElementById('feishu-ocr-cancel-btn');

    // Store current center for center-aligned resizing
    const getBoxCenter = () => ({
      x: parseInt(box.style.left, 10) + box.offsetWidth / 2,
      y: parseInt(box.style.top, 10) + box.offsetHeight / 2
    });

    const setBoxSizeFromCenter = (newW, newH) => {
      const center = getBoxCenter();
      const left = Math.max(0, center.x - newW / 2);
      const top = Math.max(0, center.y - newH / 2);
      box.style.left = `${left}px`;
      box.style.top = `${top}px`;
      box.style.width = `${newW}px`;
      box.style.height = `${newH}px`;
      // Update panel position below box
      panel.style.left = `${left}px`;
      panel.style.top = `${top + newH + 10}px`;
      // Update input value
      sizeInput.value = `${newW}x${newH}`;
    };

    confirmBtn.onclick = () => {
      selectedRect = {
        left: parseInt(box.style.left, 10),
        top: parseInt(box.style.top, 10),
        width: box.offsetWidth,
        height: box.offsetHeight
      };
      
      // Also store in localStorage for persistence
      try {
        localStorage.setItem('feishu_ocr_selectedRect', JSON.stringify(selectedRect));
      } catch (e) {}
      
      // Hide control panel but keep box visible
      panel.remove();
      // Update overlay to show confirmed state
      overlay.style.background = 'rgba(0,0,0,0.1)';
      box.style.borderColor = '#00ff00';
      box.style.background = 'rgba(0,255,0,0.1)';
      // Add a label showing confirmed
      const label = document.createElement('div');
      label.id = 'feishu-ocr-confirm-label';
      label.style.cssText = `
        position: fixed;
        top: 20px;
        left: 50%;
        transform: translateX(-50%);
        background: #00aa00;
        color: white;
        padding: 8px 16px;
        border-radius: 4px;
        font-family: Arial, sans-serif;
        font-size: 14px;
        z-index: 2147483648;
      `;
      label.textContent = `✅ Region confirmed: ${selectedRect.width}x${selectedRect.height}`;
      document.body.appendChild(label);
    };

    cancelBtn.onclick = () => {
      overlay.remove();
      overlay = null;
      panel.remove();
      overlay = null;
    };

    // Real-time update on input (no need to click Confirm)
    sizeInput.oninput = () => {
      const match = sizeInput.value.match(/^(\d+)\s*[x×]\s*(\d+)$/);
      if (match) {
        const w = Math.max(100, parseInt(match[1], 10));
        const h = Math.max(50, parseInt(match[2], 10));
        setBoxSizeFromCenter(w, h);
      }
    };

    sizeInput.onchange = () => {
      const match = sizeInput.value.match(/^(\d+)\s*[x×]\s*(\d+)$/);
      if (match) {
        const w = Math.max(100, parseInt(match[1], 10));
        const h = Math.max(50, parseInt(match[2], 10));
        setBoxSizeFromCenter(w, h);
      }
    };

    sizeInput.onkeydown = (e) => {
      if (e.key === 'Enter') sizeInput.onchange();
    };
  }
};

const Scroll = {
  findContainer() {
    const candidates = [...document.querySelectorAll('*')].filter(el => {
      const st = getComputedStyle(el);
      return /(auto|scroll)/.test(st.overflowY) && el.scrollHeight > el.clientHeight + 120;
    });
    return candidates.sort((a, b) => (b.scrollHeight - b.clientHeight) - (a.scrollHeight - a.clientHeight))[0] || document.scrollingElement;
  },
  async waitStableWindow() {
    await Util.sleep(CONFIG.wait.idleMs); // idle threshold
    const start = Date.now();
    let stable = 0;
    let prevLen = (document.body?.innerText || '').length;
    while (Date.now() - start < CONFIG.wait.stableMaxWaitMs) {
      await Util.sleep(CONFIG.wait.sampleEveryMs);
      const nowLen = (document.body?.innerText || '').length;
      if (Math.abs(nowLen - prevLen) <= 2) stable += 1;
      else stable = 0;
      prevLen = nowLen;
      if (stable >= CONFIG.wait.stableRounds) return true;
    }
    return false;
  }
};

const TextLayer = {
  extractInRect(rect) {
    const nodes = [...document.querySelectorAll('p, div, span, h1, h2, h3, li')];
    const out = [];
    for (const n of nodes) {
      const t = Util.normalizeBlock(n.innerText || '');
      if (!t || t.length < 2) continue;
      const r = n.getBoundingClientRect();
      const overlap = !(r.right < rect.left || r.left > rect.left + rect.width || r.bottom < rect.top || r.top > rect.top + rect.height);
      if (overlap) out.push(t);
    }
    return out;
  },
  dedupe(blocks) {
    const seen = new Set();
    const out = [];
    for (const b of blocks) {
      const n = Util.normalizeBlock(b);
      const key = n.length >= 20 ? n : `short:${b}`; // only high-confidence duplicate drop
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(b);
    }
    return out;
  }
};

const OCR = {
  cropDataUrl(dataUrl, rect) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const c = document.createElement('canvas');
        c.width = rect.width;
        c.height = rect.height;
        const ctx = c.getContext('2d');
        ctx.drawImage(img, rect.left, rect.top, rect.width, rect.height, 0, 0, rect.width, rect.height);
        resolve(c.toDataURL('image/png'));
      };
      img.src = dataUrl;
    });
  },
  inferLang(domBlocks) {
    const s = domBlocks.join('\n').slice(0, 2000);
    const cn = (s.match(/[\u4e00-\u9fff]/g) || []).length;
    const en = (s.match(/[A-Za-z]/g) || []).length;
    // OCR.Space: chs best for Chinese-heavy; eng for English-heavy
    return cn >= en ? 'chs' : 'eng';
  },
  async parseWithLang(imageBase64, apiKey, language) {
    const form = new FormData();
    form.append('base64Image', imageBase64);
    form.append('language', language);
    form.append('isOverlayRequired', 'false');
    const res = await fetch(CONFIG.ocr.endpoint, {
      method: 'POST',
      headers: { apikey: apiKey || 'helloworld' },
      body: form,
    });
    const json = await res.json();
    return (json?.ParsedResults || []).map(x => x.ParsedText || '').join('\n').trim();
  },
  lowConfidence(text) {
    const t = Util.normalizeBlock(text);
    if (!t) return true;
    const ascii = (t.match(/[A-Za-z0-9]/g) || []).length;
    const ratio = ascii / Math.max(1, t.length);
    return t.length < CONFIG.ocr.lowConfidenceMinLen || ratio < CONFIG.ocr.lowConfidenceAsciiRatio;
  },
  async extractWithRetry(imageBase64, apiKey, primaryLang) {
    let best = '';
    let tried = 0;
    const langs = primaryLang === 'chs' ? ['chs', 'eng'] : ['eng', 'chs'];
    for (const lang of langs) {
      for (let i = 0; i < CONFIG.ocr.retry; i += 1) {
        tried += 1;
        try {
          const text = await OCR.parseWithLang(imageBase64, apiKey, lang);
          if (text.length > best.length) best = text;
          if (!OCR.lowConfidence(text)) return { text, lang, tried, lowConfidence: false };
        } catch (_) {}
        await Util.sleep(380);
      }
    }
    return { text: best, lang: langs[0], tried, lowConfidence: OCR.lowConfidence(best) };
  }
};

async function runCaptureExtract() {
  // Try to restore from localStorage if not set
  if (!selectedRect) {
    try {
      const stored = localStorage.getItem('feishu_ocr_selectedRect');
      if (stored) {
        selectedRect = JSON.parse(stored);
      }
    } catch (e) {}
  }
  
  if (!selectedRect) {
    alert('Please select region first. Click "Select Region", choose area, then click Confirm.');
    return;
  }

  if (!selectedRect.width || !selectedRect.height) {
    alert('Invalid region. Please select region again.');
    selectedRect = null;
    try { localStorage.removeItem('feishu_ocr_selectedRect'); } catch (e) {}
    return;
  }

  const startedAtMs = Date.now();
  const scroller = Scroll.findContainer();
  const { ocrApiKey } = await chrome.storage.local.get(['ocrApiKey']);

  const domBlocksRaw = [];
  const ocrBlocksRaw = [];
  const meta = {
    started_at: Util.nowIso(),
    strategy: 'text-layer-first + OCR-fallback + low-confidence-rerecognize',
    language_policy: 'infer from text layer, fallback to both chs/eng when low-confidence',
    iterations: 0,
    ocr_calls: 0,
    low_confidence_hits: 0,
  };

  const startTop = scroller.scrollTop;
  const step = Math.max(CONFIG.scroll.minStep, Math.floor(selectedRect.height * CONFIG.scroll.stepRatio));

  let noProgressRounds = 0;
  let lastTop = -1;
  let prevHeight = scroller.scrollHeight;

  for (let i = 0; i < CONFIG.scroll.maxIterations; i += 1) {
    meta.iterations += 1;

    await Scroll.waitStableWindow();

    // text-layer first
    const pageDomBlocks = TextLayer.extractInRect(selectedRect);
    domBlocksRaw.push(...pageDomBlocks);

    // OCR fallback per viewport
    try {
      const cap = await chrome.runtime.sendMessage({ type: 'CAPTURE_VISIBLE' });
      if (cap?.ok) {
        const cropped = await OCR.cropDataUrl(cap.dataUrl, selectedRect);
        const lang = OCR.inferLang(pageDomBlocks);
        const o = await OCR.extractWithRetry(cropped, ocrApiKey, lang);
        meta.ocr_calls += o.tried;
        if (o.lowConfidence) meta.low_confidence_hits += 1;
        if (o.text) ocrBlocksRaw.push(o.text);
      }
    } catch (_) {}

    const currentTop = scroller.scrollTop;
    const nextTop = Math.min(currentTop + step, Math.max(0, scroller.scrollHeight - scroller.clientHeight));
    scroller.scrollTop = nextTop;

    const heightStable = Math.abs(scroller.scrollHeight - prevHeight) < 4;
    if (nextTop <= currentTop + 1 && currentTop === lastTop) noProgressRounds += 1;
    else noProgressRounds = 0;

    // NOT fixed wait-only stop: require no-progress + stable height window
    if (noProgressRounds >= CONFIG.scroll.maxStableRounds && heightStable) break;

    prevHeight = scroller.scrollHeight;
    lastTop = currentTop;
  }

  scroller.scrollTop = startTop;

  const domBlocks = TextLayer.dedupe(domBlocksRaw);
  const ocrBlocks = TextLayer.dedupe(ocrBlocksRaw);
  const merged = [
    '# DOM Extract (primary)',
    ...domBlocks,
    '',
    '# OCR Extract (supplement)',
    ...ocrBlocks,
  ].join('\n');

  meta.elapsed_seconds = Number(((Date.now() - startedAtMs) / 1000).toFixed(1));
  meta.dom_blocks = domBlocks.length;
  meta.ocr_blocks = ocrBlocks.length;

  const footer = `\n\n# META\n${JSON.stringify(meta, null, 2)}`;
  const fullText = merged + footer;
  const filename = `feishu-extract-${new Date().toISOString().replace(/[:.]/g, '-')}.txt`;
  
  // Store extracted text for popup access
  await chrome.storage.local.set({ 
    extractedText: fullText,
    extractedMeta: meta,
    extractedAt: Date.now()
  });
  
  await chrome.runtime.sendMessage({ type: 'SAVE_TEXT', text: fullText, filename });
  
  // Hide the red box and overlay after extraction
  const boxToRemove = document.getElementById('feishu-ocr-region-box');
  const overlayToRemove = document.getElementById('feishu-ocr-overlay');
  const labelToRemove = document.getElementById('feishu-ocr-confirm-label');
  if (boxToRemove) boxToRemove.remove();
  if (overlayToRemove) overlayToRemove.remove();
  if (labelToRemove) labelToRemove.remove();
  
  alert(`Done! Text extracted. iterations=${meta.iterations}, elapsed=${meta.elapsed_seconds}s`);
}

let isRunning = false;

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // PING handler for popup connectivity check
  if (msg?.type === 'PING') {
    sendResponse({ ok: true, pong: true, windowId: sender.tab?.windowId });
    return true;
  }

  if (msg?.type === 'START_PICK_REGION') {
    UI.pickRegion();
    sendResponse({ ok: true });
    return true;
  }

  if (msg?.type === 'RUN_CAPTURE_EXTRACT') {
    if (isRunning) {
      sendResponse({ ok: false, error: 'Already running' });
      return true;
    }
    isRunning = true;
    runCaptureExtract()
      .then(() => sendResponse({ ok: true }))
      .catch((e) => sendResponse({ ok: false, error: String(e) }))
      .finally(() => { isRunning = false; });
    return true; // async response
  }

  if (msg?.type === 'CAPTURE_VISIBLE') {
    chrome.tabs.captureVisibleTab(msg.windowId || sender.tab?.windowId, { format: 'png' })
      .then((dataUrl) => sendResponse({ ok: true, dataUrl }))
      .catch((e) => sendResponse({ ok: false, error: String(e) }));
    return true;
  }

  if (msg?.type === 'SAVE_TEXT') {
    const blob = new Blob([msg.text || ''], { type: 'text/plain' });
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

  if (msg?.type === 'GET_EXTRACTED_TEXT') {
    chrome.storage.local.get(['extractedText', 'extractedMeta', 'extractedAt'], (result) => {
      sendResponse({ 
        ok: true, 
        text: result.extractedText || '',
        meta: result.extractedMeta || null,
        extractedAt: result.extractedAt || null
      });
    });
    return true;
  }

  return false;
});
