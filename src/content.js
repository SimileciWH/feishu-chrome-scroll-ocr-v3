let selectedRect = null;
let overlay = null;

function makeOverlay() {
  const o = document.createElement('div');
  o.style.cssText = 'position:fixed;inset:0;z-index:2147483647;cursor:crosshair;background:rgba(0,0,0,0.05)';
  document.body.appendChild(o);
  return o;
}

function findScrollContainer() {
  const candidates = [...document.querySelectorAll('*')].filter(el => {
    const st = getComputedStyle(el);
    return /(auto|scroll)/.test(st.overflowY) && el.scrollHeight > el.clientHeight + 100;
  });
  return candidates.sort((a,b)=>(b.scrollHeight-b.clientHeight)-(a.scrollHeight-a.clientHeight))[0] || document.scrollingElement;
}

function rectFromPoints(a, b) {
  const left = Math.min(a.x, b.x), top = Math.min(a.y, b.y);
  return { left, top, width: Math.abs(a.x-b.x), height: Math.abs(a.y-b.y) };
}

function pickRegion() {
  if (overlay) overlay.remove();
  overlay = makeOverlay();
  let start = null;
  const box = document.createElement('div');
  box.style.cssText = 'position:fixed;border:2px solid #4f9fff;background:rgba(79,159,255,0.2);pointer-events:none;z-index:2147483647';
  overlay.appendChild(box);

  overlay.onmousedown = (e) => { start = { x: e.clientX, y: e.clientY }; };
  overlay.onmousemove = (e) => {
    if (!start) return;
    const r = rectFromPoints(start, { x: e.clientX, y: e.clientY });
    Object.assign(box.style, { left: r.left+'px', top: r.top+'px', width: r.width+'px', height: r.height+'px' });
  };
  overlay.onmouseup = (e) => {
    if (!start) return;
    selectedRect = rectFromPoints(start, { x: e.clientX, y: e.clientY });
    overlay.remove(); overlay = null;
    alert('Region selected. Open extension popup and click "Capture + Extract".');
  };
}

function cropDataUrl(dataUrl, rect) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = rect.width; c.height = rect.height;
      const ctx = c.getContext('2d');
      ctx.drawImage(img, rect.left, rect.top, rect.width, rect.height, 0, 0, rect.width, rect.height);
      resolve(c.toDataURL('image/png'));
    };
    img.src = dataUrl;
  });
}

async function ocrSpace(imageBase64, apiKey) {
  const form = new FormData();
  form.append('base64Image', imageBase64);
  form.append('language', 'chs');
  form.append('isOverlayRequired', 'false');
  const res = await fetch('https://api.ocr.space/parse/image', {
    method: 'POST', headers: { apikey: apiKey || 'helloworld' }, body: form
  });
  const json = await res.json();
  return (json?.ParsedResults || []).map(x => x.ParsedText || '').join('\n');
}

function extractDomTextInRect(rect) {
  const nodes = [...document.querySelectorAll('p, div, span, h1, h2, h3, li')];
  const lines = [];
  for (const n of nodes) {
    const t = (n.innerText || '').trim();
    if (!t || t.length < 2) continue;
    const r = n.getBoundingClientRect();
    const overlap = !(r.right < rect.left || r.left > rect.left + rect.width || r.bottom < rect.top || r.top > rect.top + rect.height);
    if (overlap) lines.push(t);
  }
  return [...new Set(lines)].join('\n');
}

async function runCaptureExtract() {
  if (!selectedRect) {
    alert('Please select region first.');
    return;
  }
  const scroller = findScrollContainer();
  const { ocrApiKey } = await chrome.storage.local.get(['ocrApiKey']);
  const total = scroller.scrollHeight;
  const step = Math.max(200, Math.floor(selectedRect.height * 0.85));
  const shots = [];

  const startTop = scroller.scrollTop;
  for (let y = 0; y < total; y += step) {
    scroller.scrollTop = y;
    await new Promise(r => setTimeout(r, 800));
    const cap = await chrome.runtime.sendMessage({ type: 'CAPTURE_VISIBLE' });
    if (!cap?.ok) break;
    const cropped = await cropDataUrl(cap.dataUrl, selectedRect);
    shots.push(cropped);
    if (y + step >= total - 2) break;
  }
  scroller.scrollTop = startTop;

  const domText = extractDomTextInRect(selectedRect);
  const ocrTexts = [];
  for (const s of shots) {
    try { ocrTexts.push(await ocrSpace(s, ocrApiKey)); } catch (e) {}
  }

  const merged = [
    '# DOM Extract (high confidence)', domText,
    '\n# OCR Extract (supplement)', ocrTexts.join('\n\n---\n\n')
  ].join('\n\n');

  const clean = merged
    .split('\n')
    .map(x => x.trim())
    .filter(Boolean)
    .filter((x, i, arr) => i === 0 || x !== arr[i - 1])
    .join('\n');

  const filename = `feishu-extract-${new Date().toISOString().replace(/[:.]/g, '-')}.txt`;
  await chrome.runtime.sendMessage({ type: 'SAVE_TEXT', text: clean, filename });
  alert('Done. TXT saved via download.');
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === 'START_PICK_REGION') pickRegion();
  if (msg?.type === 'RUN_CAPTURE_EXTRACT') runCaptureExtract();
});
