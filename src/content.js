if (window.__FEISHU_OCR_CONTENT_READY__) {
  console.debug('[feishu-ocr] content script already ready');
} else {
window.__FEISHU_OCR_CONTENT_READY__ = true;

let selectedRect = null;
let overlay = null;

const CONFIG = {
  extract: {
    ignoreImageText: true, // true => disable OCR supplement entirely
  },
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
  normalizeKeepLines(s) {
    return String(s || '')
      .replace(/\u200b/g, '')
      .replace(/\r\n?/g, '\n')
      .split('\n')
      .map((line) => line.replace(/\s+/g, ' ').trim())
      .filter(Boolean)
      .join('\n');
  },
  nowIso() { return new Date().toISOString(); },
};

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

function getRegionStorageKey(tabId) {
  return Number.isFinite(tabId) ? `selectedRect_${tabId}` : null;
}

function sanitizeFilenamePart(s) {
  const cleaned = String(s || '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/[\\/:*?"<>|]/g, ' ')
    .replace(/[^\p{L}\p{N}\p{Script=Han}\s._()-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[.\s]+|[.\s]+$/g, '')
    .slice(0, 64);
  return cleaned || 'feishu-extract';
}

function getDocTitleForFilename() {
  const h1 = document.querySelector('h1');
  const metaTitle = document.querySelector('meta[property="og:title"]')?.getAttribute('content') || '';
  const titleCandidates = [
    h1?.innerText || '',
    metaTitle,
    document.title || ''
  ].map((t) => t.trim()).filter(Boolean);

  for (const raw of titleCandidates) {
    let t = raw
      .replace(/\s*-\s*飞书.*$/i, '')
      .replace(/\s*-\s*Feishu.*$/i, '')
      .replace(/\s*\|\s*飞书.*$/i, '')
      .replace(/\s*\|\s*Feishu.*$/i, '')
      .trim();
    t = sanitizeFilenamePart(t);
    if (t && t.length >= 2) return t;
  }
  return '';
}

const UI = {
  minWidth: 100,
  minHeight: 50,

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
      min-width: ${UI.minWidth}px;
      min-height: ${UI.minHeight}px;
      box-sizing: border-box;
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

  makeInlineControls(box) {
    const toolbar = document.createElement('div');
    toolbar.id = 'feishu-ocr-control-panel';
    toolbar.style.cssText = `
      position:absolute;
      top:8px;
      left:8px;
      z-index:2;
      display:flex;
      align-items:center;
      gap:6px;
      background:rgba(255,255,255,0.96);
      border:1px solid #ddd;
      border-radius:6px;
      padding:6px;
      box-shadow:0 1px 6px rgba(0,0,0,0.2);
      font-family:Arial,sans-serif;
      font-size:12px;
      max-width:calc(100% - 16px);
    `;
    toolbar.innerHTML = `
      <button id="feishu-ocr-confirm-btn" style="padding:2px 8px;background:#2f80ed;color:#fff;border:none;border-radius:4px;cursor:pointer;">Confirm</button>
      <button id="feishu-ocr-cancel-btn" style="padding:2px 8px;background:#eee;color:#333;border:1px solid #ccc;border-radius:4px;cursor:pointer;">Cancel</button>
      <span style="font-size:11px;color:#666;white-space:nowrap;">Drag edges/corners to resize</span>
    `;
    box.appendChild(toolbar);
    return toolbar;
  },

  makeResizeHandles(box) {
    const handles = [
      { dir: 'n', css: 'top:-5px;left:50%;transform:translateX(-50%);cursor:n-resize;' },
      { dir: 's', css: 'bottom:-5px;left:50%;transform:translateX(-50%);cursor:s-resize;' },
      { dir: 'w', css: 'left:-5px;top:50%;transform:translateY(-50%);cursor:w-resize;' },
      { dir: 'e', css: 'right:-5px;top:50%;transform:translateY(-50%);cursor:e-resize;' },
      { dir: 'nw', css: 'left:-6px;top:-6px;cursor:nw-resize;' },
      { dir: 'ne', css: 'right:-6px;top:-6px;cursor:ne-resize;' },
      { dir: 'sw', css: 'left:-6px;bottom:-6px;cursor:sw-resize;' },
      { dir: 'se', css: 'right:-6px;bottom:-6px;cursor:se-resize;' }
    ];
    handles.forEach((h) => {
      const el = document.createElement('div');
      el.className = 'feishu-ocr-resize-handle';
      el.dataset.dir = h.dir;
      el.style.cssText = `
        position:absolute;
        width:10px;
        height:10px;
        border:1px solid #fff;
        background:#ff2e2e;
        border-radius:2px;
        z-index:3;
        ${h.css}
      `;
      box.appendChild(el);
    });
  },

  applyRect(box, rect) {
    const maxLeft = Math.max(0, window.innerWidth - rect.width);
    const maxTop = Math.max(0, window.innerHeight - rect.height);
    box.style.left = `${Math.max(0, Math.min(maxLeft, rect.left))}px`;
    box.style.top = `${Math.max(0, Math.min(maxTop, rect.top))}px`;
    box.style.width = `${Math.max(UI.minWidth, Math.min(window.innerWidth, rect.width))}px`;
    box.style.height = `${Math.max(UI.minHeight, Math.min(window.innerHeight, rect.height))}px`;
  },

  makeInteractive(box) {
    let dragState = null;

    const readRect = () => ({
      left: parseInt(box.style.left, 10) || 0,
      top: parseInt(box.style.top, 10) || 0,
      width: box.offsetWidth,
      height: box.offsetHeight
    });

    const onMouseDown = (e) => {
      const target = e.target;
      if (target.closest('#feishu-ocr-control-panel') && !target.classList.contains('feishu-ocr-resize-handle')) {
        return;
      }
      const handle = target.closest('.feishu-ocr-resize-handle');
      const base = readRect();
      if (handle) {
        dragState = { mode: 'resize', dir: handle.dataset.dir, x: e.clientX, y: e.clientY, base };
      } else {
        dragState = { mode: 'move', x: e.clientX, y: e.clientY, base };
      }
      e.preventDefault();
    };

    const onMouseMove = (e) => {
      if (!dragState) return;
      const dx = e.clientX - dragState.x;
      const dy = e.clientY - dragState.y;
      const next = { ...dragState.base };

      if (dragState.mode === 'move') {
        next.left = dragState.base.left + dx;
        next.top = dragState.base.top + dy;
      } else {
        const { dir } = dragState;
        if (dir.includes('e')) next.width = dragState.base.width + dx;
        if (dir.includes('s')) next.height = dragState.base.height + dy;
        if (dir.includes('w')) {
          next.left = dragState.base.left + dx;
          next.width = dragState.base.width - dx;
        }
        if (dir.includes('n')) {
          next.top = dragState.base.top + dy;
          next.height = dragState.base.height - dy;
        }
      }
      UI.applyRect(box, next);
    };

    const onMouseUp = () => { dragState = null; };

    box.addEventListener('mousedown', onMouseDown);
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);

    return () => {
      box.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };
  },

  pickRegion(defaultSize, defaultRegionRect, sourceTabId) {
    const oldOverlay = document.getElementById('feishu-ocr-overlay');
    if (oldOverlay) oldOverlay.remove();
    const oldLabel = document.getElementById('feishu-ocr-confirm-label');
    if (oldLabel) oldLabel.remove();
    if (overlay) overlay.remove();
    overlay = UI.makeOverlay();
    
    const defaultW = Math.max(UI.minWidth, Math.min(window.innerWidth, defaultSize?.width || 800));
    const defaultH = Math.max(UI.minHeight, Math.min(window.innerHeight, defaultSize?.height || 600));
    const box = UI.makeRegionBox(defaultW, defaultH);
    if (defaultRegionRect && Number.isFinite(defaultRegionRect.left) && Number.isFinite(defaultRegionRect.top) && Number.isFinite(defaultRegionRect.width) && Number.isFinite(defaultRegionRect.height)) {
      UI.applyRect(box, {
        left: defaultRegionRect.left,
        top: defaultRegionRect.top,
        width: defaultRegionRect.width,
        height: defaultRegionRect.height
      });
    }
    overlay.appendChild(box);

    const panel = UI.makeInlineControls(box);
    UI.makeResizeHandles(box);

    const confirmBtn = document.getElementById('feishu-ocr-confirm-btn');
    const cancelBtn = document.getElementById('feishu-ocr-cancel-btn');
    const cleanupInteractive = UI.makeInteractive(box);

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
      try {
        chrome.storage.local.set({ pendingRegionRect: selectedRect });
      } catch (e) {}
      try {
        const regionKey = getRegionStorageKey(sourceTabId);
        if (regionKey) chrome.storage.local.set({ [regionKey]: selectedRect });
      } catch (e) {}
      
      cleanupInteractive();
      panel.remove();
      box.querySelectorAll('.feishu-ocr-resize-handle').forEach((el) => el.remove());
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
      cleanupInteractive();
      overlay.remove();
      overlay = null;
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
  compactText(s) {
    return String(s || '')
      .toLowerCase()
      .replace(/[\s\u00a0]/g, '')
      .replace(/[，。、“”‘’：:；;,.!?！？【】\[\]()（）\-—_~`'"<>《》]/g, '');
  },
  isNoiseNode(node) {
    const el = node?.closest?.('[class],[id],[role],[aria-label]');
    if (!el) return false;
    const sig = `${el.id || ''} ${el.className || ''} ${el.getAttribute?.('role') || ''} ${el.getAttribute?.('aria-label') || ''}`.toLowerCase();
    return /(sidebar|aside|toolbar|comment|quickview|suggest|backlink|mention|catalog|toc|outline|menu|popover|dialog|header)/.test(sig);
  },
  extractInRect(rect) {
    const nodes = [...document.querySelectorAll('p, div, span, h1, h2, h3, li')];
    const out = [];
    for (const n of nodes) {
      if (TextLayer.isNoiseNode(n)) continue;
      // Prefer leaf-ish nodes to avoid merging an entire document region into one line.
      const hasRichChildren = [...(n.children || [])].some((c) => /^(P|DIV|LI|H1|H2|H3)$/i.test(c.tagName));
      if (hasRichChildren && /^(DIV|SPAN)$/i.test(n.tagName)) continue;

      const t = Util.normalizeKeepLines(n.innerText || '');
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
  },
  dedupeSmart(lines) {
    const kept = [];
    const minContainLen = 10;
    const minGap = 4;

    for (const raw of lines) {
      const line = Util.normalizeBlock(raw);
      if (!line) continue;
      const compact = TextLayer.compactText(line);
      if (!compact) continue;

      // 1) exact duplicate
      if (kept.some((k) => k.compact === compact)) continue;

      // 2) fragment of an existing longer sentence
      const covered = kept.some((k) => (
        compact.length >= minContainLen &&
        k.compact.includes(compact) &&
        (k.compact.length - compact.length) >= minGap
      ));
      if (covered) continue;

      // 3) this new line is a fuller sentence; drop older fragments it covers
      const nextKept = kept.filter((k) => !(
        compact.length >= (minContainLen + minGap) &&
        compact.includes(k.compact) &&
        k.compact.length >= minContainLen &&
        (compact.length - k.compact.length) >= minGap
      ));
      kept.length = 0;
      kept.push(...nextKept);
      kept.push({ line, compact });
    }

    return kept.map((k) => k.line);
  }
};

const TextFilter = {
  noisePatterns: [
    /\bAI QuickView\b/i,
    /\bFree trial\b/i,
    /\bSuggestions are generated by AI\b/i,
    /\bYou Might Also Wonder\b/i,
    /\bBacklinks\b/i,
    /\bMentioned Docs\b/i,
    /\bGraph view\b/i,
    /\bUpload Log\b/i,
    /\bCustomer Service\b/i,
    /\bWhat's New\b/i,
    /\bHelp Center\b/i,
    /\bKeyboard Shortcuts\b/i,
    /\bComments?\s*\(\d+\)\b/i,
    /\bLikes?\b/i,
    /\bExternal\b/i,
    /\bLast modified\b/i,
    /\bShare\b/i
  ],
  keepEnglishTerms: /\b(API|SDK|HTTP|HTTPS|JSON|JavaScript|TypeScript|SQL|Chrome|OCR|OpenAI|URL|UI|UX|ToB|ToG)\b/i,
  splitLines(block) {
    return String(block || '')
      .split(/\n+/)
      .map((s) => Util.normalizeKeepLines(s))
      .filter(Boolean);
  },
  ratio(line, re) {
    const m = line.match(re);
    return (m ? m.length : 0) / Math.max(1, line.length);
  },
  hasNoise(line) {
    return TextFilter.noisePatterns.some((re) => re.test(line));
  },
  isLikelyUiLabel(line) {
    if (line.length > 70) return false;
    if (/^[A-Za-z0-9 _\-:()/.]+$/.test(line) && !/[\u4e00-\u9fff]/.test(line)) return true;
    return false;
  },
  keepLine(line, mode) {
    if (!line) return false;
    if (TextFilter.hasNoise(line)) return false;
    if (mode === 'bilingual') return true;

    const zhRatio = TextFilter.ratio(line, /[\u4e00-\u9fff]/g);
    const enRatio = TextFilter.ratio(line, /[A-Za-z]/g);
    const hasKeepTerm = TextFilter.keepEnglishTerms.test(line);

    if (mode === 'cn_strict') {
      if (zhRatio > 0.08) return true;
      return hasKeepTerm && line.length >= 8;
    }

    // auto mode: keep mixed/Chinese; drop short pure-English UI-like lines.
    if (zhRatio > 0.06) return true;
    if (hasKeepTerm && line.length >= 8) return true;
    if (enRatio > 0.65 && TextFilter.isLikelyUiLabel(line)) return false;
    if (enRatio > 0.8 && line.length < 32) return false;
    return enRatio <= 0.9 || line.length > 80;
  },
  filterBlocks(blocks, mode = 'auto') {
    const outLines = [];
    for (const block of blocks) {
      const lines = TextFilter.splitLines(block).filter((line) => TextFilter.keepLine(line, mode));
      if (!lines.length) continue;
      outLines.push(...lines);
    }
    return TextLayer.dedupeSmart(outLines);
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

async function runCaptureExtract(tabId) {
  const storageKeys = getExtractStorageKeys(tabId);
  const regionKey = getRegionStorageKey(tabId);
  // Send initial status to popup via both message and storage
  try {
    chrome.runtime.sendMessage({ type: 'EXTRACT_PROGRESS', progress: 'starting', iteration: 0 });
    await chrome.storage.local.set({ 
      [storageKeys.progress]: { progress: 'starting', iteration: 0 }
    });
  } catch (e) {}

  // Try to restore from localStorage if not set
  if (!selectedRect && regionKey) {
    try {
      const scoped = await chrome.storage.local.get([regionKey]);
      if (scoped?.[regionKey]) selectedRect = scoped[regionKey];
    } catch (e) {}
  }
  if (!selectedRect) {
    try {
      const stored = localStorage.getItem('feishu_ocr_selectedRect');
      if (stored) {
        selectedRect = JSON.parse(stored);
      }
    } catch (e) {}
  }
  if (!selectedRect) {
    try {
      const stored = await chrome.storage.local.get(['defaultRegionRect']);
      if (stored?.defaultRegionRect) selectedRect = stored.defaultRegionRect;
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
  const { ocrApiKey, languageMode } = await chrome.storage.local.get(['ocrApiKey', 'languageMode']);
  const effectiveLanguageMode = ['auto', 'cn_strict', 'bilingual'].includes(languageMode) ? languageMode : 'auto';

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

  const doExtractPass = async (i) => {
    meta.iterations += 1;
    
    // Send progress update via both message and storage
    try {
      chrome.runtime.sendMessage({ 
        type: 'EXTRACT_PROGRESS', 
        progress: 'scrolling',
        iteration: i,
        message: `Scrolling... (${i + 1})`
      });
      await chrome.storage.local.set({ 
        [storageKeys.progress]: { 
          progress: 'scrolling', 
          iteration: i,
          message: `正在滚动... (${i + 1})`
        }
      });
    } catch (e) {}

    // text-layer first
    const pageDomBlocks = TextLayer.extractInRect(selectedRect);
    domBlocksRaw.push(...pageDomBlocks);

    // Ignore image text when configured: no screenshot OCR pass.
    if (!CONFIG.extract.ignoreImageText) {
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
    }
  };

  await Scroll.waitStableWindow();
  await doExtractPass(0);

  for (let i = 1; i < CONFIG.scroll.maxIterations; i += 1) {
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
    await Scroll.waitStableWindow();
    await doExtractPass(i);
  }

  scroller.scrollTop = startTop;

  const domBlocks = TextFilter.filterBlocks(domBlocksRaw, effectiveLanguageMode);
  const ocrBlocks = CONFIG.extract.ignoreImageText ? [] : TextFilter.filterBlocks(ocrBlocksRaw, effectiveLanguageMode);
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
  meta.language_mode = effectiveLanguageMode;
  meta.ignore_image_text = CONFIG.extract.ignoreImageText;

  const footer = `\n\n# META\n${JSON.stringify(meta, null, 2)}`;
  const fullText = merged + footer;
  const title = getDocTitleForFilename();
  const fallbackTs = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = title ? `${title}.txt` : `feishu-extract-${fallbackTs}.txt`;
  
  // Store extracted text for popup access
  await chrome.storage.local.set({ 
    [storageKeys.text]: fullText,
    [storageKeys.meta]: meta,
    [storageKeys.at]: Date.now(),
    [storageKeys.filename]: filename,
    [storageKeys.progress]: { 
      progress: 'done', 
      iteration: meta.iterations,
      charCount: fullText.length,
      message: `完成! ${meta.iterations} 次迭代`
    }
  });
  
  await chrome.runtime.sendMessage({ type: 'SAVE_TEXT', text: fullText, filename });
  
  // Hide the red box and overlay after extraction
  const boxToRemove = document.getElementById('feishu-ocr-region-box');
  const overlayToRemove = document.getElementById('feishu-ocr-overlay');
  const labelToRemove = document.getElementById('feishu-ocr-confirm-label');
  if (boxToRemove) boxToRemove.remove();
  if (overlayToRemove) overlayToRemove.remove();
  if (labelToRemove) labelToRemove.remove();
  
  // Send completion signal to popup
  try {
    chrome.runtime.sendMessage({ 
      type: 'EXTRACT_PROGRESS', 
      progress: 'done',
      iterations: meta.iterations,
      charCount: fullText.length,
      message: `Done! ${meta.iterations} iterations`
    });
  } catch (e) {}
  
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
    UI.pickRegion(msg?.defaultRegionSize, msg?.defaultRegionRect, msg?.tabId);
    sendResponse({ ok: true });
    return true;
  }

  if (msg?.type === 'GET_REGION_STATE') {
    const regionStateReply = async () => {
      const key = getRegionStorageKey(msg?.tabId);
      if (!key) {
        sendResponse({ ok: true, hasRegion: false, rect: null, title: getDocTitleForFilename() || document.title || '' });
        return;
      }
      let rect = null;
      try {
        const scoped = await chrome.storage.local.get([key]);
        rect = scoped?.[key] || null;
      } catch (_) {}
      const hasRegion = !!(rect && rect.width && rect.height);
      sendResponse({
        ok: true,
        hasRegion,
        rect: hasRegion ? rect : null,
        title: getDocTitleForFilename() || document.title || ''
      });
    };
    regionStateReply();
    return true;
  }

  if (msg?.type === 'RUN_CAPTURE_EXTRACT') {
    if (isRunning) {
      sendResponse({ ok: false, error: 'Already running' });
      return true;
    }
    isRunning = true;
    runCaptureExtract(msg?.tabId)
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
    const keys = getExtractStorageKeys(msg?.tabId);
    chrome.storage.local.get([keys.text, keys.meta, keys.at, keys.filename], (result) => {
      sendResponse({ 
        ok: true, 
        text: result[keys.text] || '',
        meta: result[keys.meta] || null,
        extractedAt: result[keys.at] || null,
        filename: result[keys.filename] || null
      });
    });
    return true;
  }

  return false;
});
}
