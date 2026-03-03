let selectedRect = null;
let overlay = null;

const CONFIG = {
  scroll: { maxIterations: 160, minStep: 220, stepRatio: 0.82, maxStableRounds: 4 },
  wait: { idleMs: 450, stableMaxWaitMs: 3200, sampleEveryMs: 220, stableRounds: 3 },
  ocr: { endpoint: 'https://api.ocr.space/parse/image', retry: 2 }
};

const U = {
  sleep: (ms) => new Promise(r => setTimeout(r, ms)),
  norm: (s) => (s || '').replace(/\u200b/g, '').replace(/\s+/g, ' ').trim()
};

async function progress(text, level = 'info', extra = {}) {
  try { await chrome.runtime.sendMessage({ type: 'PROGRESS', text, level, extra }); } catch (_) {}
  toast(text, level);
}

function toast(text, level = 'info') {
  const id = 'fso-toast';
  let el = document.getElementById(id);
  if (!el) {
    el = document.createElement('div');
    el.id = id;
    el.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:2147483647;padding:10px 12px;border-radius:8px;font-size:12px;max-width:320px;box-shadow:0 2px 10px rgba(0,0,0,.2);';
    document.body.appendChild(el);
  }
  el.style.background = level === 'error' ? '#b00020' : '#1f2937';
  el.style.color = '#fff';
  el.textContent = `Feishu OCR: ${text}`;
}

function findScrollContainer() {
  const cands = [...document.querySelectorAll('*')].filter(el => {
    const st = getComputedStyle(el);
    return /(auto|scroll)/.test(st.overflowY) && el.scrollHeight > el.clientHeight + 120;
  });
  return cands.sort((a,b)=>(b.scrollHeight-b.clientHeight)-(a.scrollHeight-a.clientHeight))[0] || document.scrollingElement;
}

function rectFromPoints(a, b) {
  const left = Math.min(a.x,b.x), top = Math.min(a.y,b.y);
  return { left, top, width: Math.abs(a.x-b.x), height: Math.abs(a.y-b.y) };
}

function startPickRegion() {
  if (overlay) overlay.remove();
  overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;z-index:2147483647;cursor:crosshair;background:rgba(59,130,246,0.08)';
  document.body.appendChild(overlay);
  progress('选区模式已开启，请拖拽框选正文区域');

  let start = null;
  const box = document.createElement('div');
  box.style.cssText = 'position:fixed;border:2px solid #3b82f6;background:rgba(59,130,246,0.18);pointer-events:none;z-index:2147483647';
  overlay.appendChild(box);

  overlay.onmousedown = (e) => { start = { x: e.clientX, y: e.clientY }; };
  overlay.onmousemove = (e) => {
    if (!start) return;
    const r = rectFromPoints(start, { x: e.clientX, y: e.clientY });
    Object.assign(box.style, { left:`${r.left}px`, top:`${r.top}px`, width:`${r.width}px`, height:`${r.height}px` });
  };
  overlay.onmouseup = (e) => {
    if (!start) return;
    selectedRect = rectFromPoints(start, { x: e.clientX, y: e.clientY });
    overlay.remove(); overlay = null;
    progress(`选区已确认：${Math.round(selectedRect.width)}x${Math.round(selectedRect.height)}`);
  };
}

async function waitStableWindow() {
  await U.sleep(CONFIG.wait.idleMs);
  const start = Date.now();
  let stable = 0;
  let prevLen = (document.body?.innerText || '').length;
  while (Date.now() - start < CONFIG.wait.stableMaxWaitMs) {
    await U.sleep(CONFIG.wait.sampleEveryMs);
    const nowLen = (document.body?.innerText || '').length;
    if (Math.abs(nowLen - prevLen) <= 2) stable++; else stable = 0;
    prevLen = nowLen;
    if (stable >= CONFIG.wait.stableRounds) return true;
  }
  return false;
}

function extractDomTextInRect(rect) {
  const nodes = [...document.querySelectorAll('p, div, span, h1, h2, h3, li')];
  const out = [];
  for (const n of nodes) {
    const t = U.norm(n.innerText);
    if (!t || t.length < 2) continue;
    const r = n.getBoundingClientRect();
    const overlap = !(r.right < rect.left || r.left > rect.left + rect.width || r.bottom < rect.top || r.top > rect.top + rect.height);
    if (overlap) out.push(t);
  }
  return out;
}

function dedupeHighConfidence(blocks) {
  const seen = new Set();
  const out = [];
  for (const b of blocks) {
    const n = U.norm(b);
    const key = n.length >= 20 ? n : `short:${b}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(b);
  }
  return out;
}

async function cropDataUrl(dataUrl, rect) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = rect.width; c.height = rect.height;
      c.getContext('2d').drawImage(img, rect.left, rect.top, rect.width, rect.height, 0, 0, rect.width, rect.height);
      resolve(c.toDataURL('image/png'));
    };
    img.src = dataUrl;
  });
}

async function ocrSpace(base64, apiKey, language = 'chs') {
  const form = new FormData();
  form.append('base64Image', base64);
  form.append('language', language);
  form.append('isOverlayRequired', 'false');
  const res = await fetch(CONFIG.ocr.endpoint, { method: 'POST', headers: { apikey: apiKey || 'helloworld' }, body: form });
  const json = await res.json();
  return (json?.ParsedResults || []).map(x => x.ParsedText || '').join('\n').trim();
}

function likelyLowConfidence(text) {
  const t = U.norm(text);
  return !t || t.length < 24;
}

async function runCaptureExtract() {
  if (!selectedRect) throw new Error('未选择区域，请先点击 Select Region');

  const started = Date.now();
  const scroller = findScrollContainer();
  const { ocrApiKey } = await chrome.storage.local.get(['ocrApiKey']);

  await progress('准备中：初始化滚动与提取策略');

  const domBlocksRaw = [];
  const ocrBlocksRaw = [];
  const startTop = scroller.scrollTop;
  const step = Math.max(CONFIG.scroll.minStep, Math.floor(selectedRect.height * CONFIG.scroll.stepRatio));

  let noProgressRounds = 0;
  let prevHeight = scroller.scrollHeight;
  let lastTextTotal = 0;
  let bottomHitRounds = 0;
  let iterations = 0;

  for (let i = 0; i < CONFIG.scroll.maxIterations; i++) {
    iterations++;
    await progress(`滚动中：第 ${iterations} 屏`, 'info', { stage: 'scroll' });
    await waitStableWindow();

    const pageBlocks = extractDomTextInRect(selectedRect);
    domBlocksRaw.push(...pageBlocks);
    const textTotal = domBlocksRaw.join('\n').length;

    try {
      const cap = await chrome.runtime.sendMessage({ type: 'CAPTURE_VISIBLE' });
      if (cap?.ok) {
        const cropped = await cropDataUrl(cap.dataUrl, selectedRect);
        let o = await ocrSpace(cropped, ocrApiKey, 'chs');
        if (likelyLowConfidence(o)) o = await ocrSpace(cropped, ocrApiKey, 'eng');
        if (o) ocrBlocksRaw.push(o);
      }
    } catch (_) {}

    const currentTop = scroller.scrollTop;
    const maxTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
    const nextTop = Math.min(currentTop + step, maxTop);
    scroller.scrollTop = nextTop;

    const heightStable = Math.abs(scroller.scrollHeight - prevHeight) < 4;
    const textGrowthSmall = (textTotal - lastTextTotal) < 30;
    const hitBottom = nextTop >= maxTop - 2;

    if (nextTop <= currentTop + 1) noProgressRounds++; else noProgressRounds = 0;
    if (hitBottom) bottomHitRounds++; else bottomHitRounds = 0;

    // 多信号终止：高度稳定 + 文本增量小 + 底部命中重复 + 无位移
    if (heightStable && textGrowthSmall && bottomHitRounds >= 2 && noProgressRounds >= 2) break;

    prevHeight = scroller.scrollHeight;
    lastTextTotal = textTotal;
  }

  scroller.scrollTop = startTop;

  await progress('识别中：融合文本与OCR结果');
  const domBlocks = dedupeHighConfidence(domBlocksRaw);
  const ocrBlocks = dedupeHighConfidence(ocrBlocksRaw);
  const elapsed = ((Date.now() - started) / 1000).toFixed(1);

  const merged = [
    '# DOM Extract (primary)',
    ...domBlocks,
    '',
    '# OCR Extract (fallback)',
    ...ocrBlocks,
    '',
    '# META',
    `iterations=${iterations}`,
    `elapsed_seconds=${elapsed}`,
    `dom_blocks=${domBlocks.length}`,
    `ocr_blocks=${ocrBlocks.length}`
  ].join('\n');

  const filename = `feishu-extract-${new Date().toISOString().replace(/[:.]/g,'-')}.txt`;
  const saved = await chrome.runtime.sendMessage({ type: 'SAVE_TEXT', text: merged, filename });
  if (!saved?.ok) throw new Error(saved?.error || '保存失败');

  await progress(`完成：已导出 ${filename}`);
  return { ok: true, message: `提取完成（${iterations} 屏，${elapsed}s）`, filename };
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    if (msg?.type === 'PING') {
      return sendResponse({ ok: true, message: 'content ready', href: location.href, hasRegion: !!selectedRect });
    }
    if (msg?.type === 'START_PICK_REGION') {
      startPickRegion();
      return sendResponse({ ok: true, message: '已进入选区模式（页面出现蓝色遮罩）' });
    }
    if (msg?.type === 'RUN_CAPTURE_EXTRACT') {
      const r = await runCaptureExtract();
      return sendResponse(r);
    }
    return sendResponse({ ok: false, error: `unknown message: ${msg?.type}` });
  })().catch(async (e) => {
    await progress(`错误：${String(e.message || e)}`, 'error');
    sendResponse({ ok: false, error: String(e.message || e) });
  });
  return true;
});
