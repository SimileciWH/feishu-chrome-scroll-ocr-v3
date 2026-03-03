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
    o.style.cssText = 'position:fixed;inset:0;z-index:2147483647;cursor:crosshair;background:rgba(0,0,0,0.05)';
    document.body.appendChild(o);
    return o;
  },
  rectFromPoints(a, b) {
    const left = Math.min(a.x, b.x), top = Math.min(a.y, b.y);
    return { left, top, width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y) };
  },
  pickRegion() {
    if (overlay) overlay.remove();
    overlay = UI.makeOverlay();
    let start = null;
    const box = document.createElement('div');
    box.style.cssText = 'position:fixed;border:2px solid #4f9fff;background:rgba(79,159,255,0.2);pointer-events:none;z-index:2147483647';
    overlay.appendChild(box);

    overlay.onmousedown = (e) => { start = { x: e.clientX, y: e.clientY }; };
    overlay.onmousemove = (e) => {
      if (!start) return;
      const r = UI.rectFromPoints(start, { x: e.clientX, y: e.clientY });
      Object.assign(box.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
    };
    overlay.onmouseup = (e) => {
      if (!start) return;
      selectedRect = UI.rectFromPoints(start, { x: e.clientX, y: e.clientY });
      overlay.remove();
      overlay = null;
      alert('Region selected. Open extension popup and click "Capture + Extract".');
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
  if (!selectedRect) {
    alert('Please select region first.');
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
  const filename = `feishu-extract-${new Date().toISOString().replace(/[:.]/g, '-')}.txt`;
  await chrome.runtime.sendMessage({ type: 'SAVE_TEXT', text: merged + footer, filename });
  alert(`Done. TXT saved via download. iterations=${meta.iterations}, elapsed=${meta.elapsed_seconds}s`);
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === 'START_PICK_REGION') UI.pickRegion();
  if (msg?.type === 'RUN_CAPTURE_EXTRACT') runCaptureExtract();
});
