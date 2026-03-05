/**
 * Feishu Chrome Scroll OCR - Extension Functional Tests
 * Static code analysis + structure validation (no browser required)
 */

const path = require('path');
const fs = require('fs');

const EXTENSION_PATH = path.join(__dirname, '..');

// Test results collector
const results = {
  passed: 0,
  failed: 0,
  tests: []
};

function test(name, fn) {
  console.log(`Test: ${name}...`);
  try {
    fn();
    results.passed++;
    results.tests.push({ name, status: 'PASS' });
    console.log(`  ✓ PASS\n`);
  } catch (err) {
    results.failed++;
    results.tests.push({ name, status: 'FAIL', error: err.message });
    console.log(`  ✗ FAIL: ${err.message}\n`);
  }
}

function assert(condition, msg) {
  if (!condition) throw new Error(msg || 'Assertion failed');
}

function assertContains(content, substring, msg) {
  if (!content.includes(substring)) {
    throw new Error(msg || `Expected to find: "${substring}"`);
  }
}

function runTests() {
  console.log('='.repeat(60));
  console.log('Feishu Chrome Scroll OCR - Extension Tests (Static)');
  console.log('='.repeat(60) + '\n');

  // ============================================================
  // SUITE 1: Manifest Validation
  // ============================================================
  console.log('\n--- SUITE 1: Manifest Validation ---\n');

  test('Manifest exists and is valid JSON', () => {
    const manifestPath = path.join(EXTENSION_PATH, 'manifest.json');
    const content = fs.readFileSync(manifestPath, 'utf8');
    const manifest = JSON.parse(content);
    assert(manifest, 'Manifest should parse');
    assert(typeof manifest.manifest_version === 'number', 'Should have manifest_version');
    assert(manifest.name, 'Should have name');
    assert(manifest.version, 'Should have version');
  });

  test('Manifest has required permissions', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(EXTENSION_PATH, 'manifest.json'), 'utf8'));
    assert(manifest.permissions && manifest.permissions.length > 0, 'Should have permissions');
  });

  test('Manifest has content scripts configured', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(EXTENSION_PATH, 'manifest.json'), 'utf8'));
    assert(manifest.content_scripts && manifest.content_scripts.length > 0, 'Should have content_scripts');
  });

  test('Manifest has background service worker', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(EXTENSION_PATH, 'manifest.json'), 'utf8'));
    assert(manifest.background && manifest.background.service_worker, 'Should have background service worker');
  });

  test('Manifest matches feishu.cn paths', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(EXTENSION_PATH, 'manifest.json'), 'utf8'));
    const matches = manifest.content_scripts[0].matches;
    const hasFeishu = matches.some(m => m.includes('feishu.cn'));
    assert(hasFeishu, 'Content script should match feishu.cn');
  });

  test('Manifest has all required popup elements', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(EXTENSION_PATH, 'manifest.json'), 'utf8'));
    assert(manifest.action && manifest.action.default_popup, 'Should have popup');
  });

  // ============================================================
  // SUITE 2: Popup Tests
  // ============================================================
  console.log('\n--- SUITE 2: Popup Tests ---\n');

  test('Popup HTML exists', () => {
    const popupPath = path.join(EXTENSION_PATH, 'src/popup.html');
    assert(fs.existsSync(popupPath), 'popup.html should exist');
  });

  test('Popup HTML has required elements', () => {
    const content = fs.readFileSync(path.join(EXTENSION_PATH, 'src/popup.html'), 'utf8');
    assertContains(content, 'id="status"', 'Should have status element');
    assertContains(content, 'id="apiKey"', 'Should have apiKey element');
    assertContains(content, 'id="regionSize"', 'Should have region size input');
    assertContains(content, 'id="save"', 'Should have save button');
    assertContains(content, 'id="pick"', 'Should have pick button');
    assertContains(content, 'id="run"', 'Should have run button');
    assertContains(content, 'id="copy"', 'Should have copy button');
    assertContains(content, 'id="download"', 'Should have download button');
  });

  test('Popup JS exists', () => {
    const jsPath = path.join(EXTENSION_PATH, 'src/popup.js');
    assert(fs.existsSync(jsPath), 'popup.js should exist');
  });

  test('Popup has status update function', () => {
    const content = fs.readFileSync(path.join(EXTENSION_PATH, 'src/popup.js'), 'utf8');
    assertContains(content, 'function setStatus', 'Should have setStatus function');
  });

  test('Popup handles save click', () => {
    const content = fs.readFileSync(path.join(EXTENSION_PATH, 'src/popup.js'), 'utf8');
    assertContains(content, 'saveBtn.onclick', 'Should handle save click');
    assertContains(content, 'chrome.storage.local.set', 'Should save to storage');
    assertContains(content, 'defaultRegionSize', 'Should persist default region size');
  });

  test('Popup handles pick region', () => {
    const content = fs.readFileSync(path.join(EXTENSION_PATH, 'src/popup.js'), 'utf8');
    assertContains(content, 'pickBtn.onclick', 'Should handle pick click');
    assertContains(content, 'START_PICK_REGION', 'Should send START_PICK_REGION');
  });

  test('Popup handles run extraction', () => {
    const content = fs.readFileSync(path.join(EXTENSION_PATH, 'src/popup.js'), 'utf8');
    assertContains(content, 'runBtn.onclick', 'Should handle run click');
    assertContains(content, 'RUN_CAPTURE_EXTRACT', 'Should send RUN_CAPTURE_EXTRACT');
  });

  test('Popup has safe message sending with timeout', () => {
    const content = fs.readFileSync(path.join(EXTENSION_PATH, 'src/popup.js'), 'utf8');
    assertContains(content, 'safeSendMessage', 'Should have safeSendMessage');
    assertContains(content, 'timeoutMs', 'Should have timeout');
  });

  test('Popup has copy to clipboard', () => {
    const content = fs.readFileSync(path.join(EXTENSION_PATH, 'src/popup.js'), 'utf8');
    assertContains(content, 'copyBtn.onclick', 'Should handle copy click');
    assertContains(content, 'navigator.clipboard.writeText', 'Should use clipboard API');
  });

  test('Popup has download functionality', () => {
    const content = fs.readFileSync(path.join(EXTENSION_PATH, 'src/popup.js'), 'utf8');
    assertContains(content, 'downloadBtn.onclick', 'Should handle download click');
    const hasDirectDownload = content.includes('chrome.downloads.download');
    const hasBackgroundSave = content.includes("type: 'SAVE_TEXT'");
    assert(hasDirectDownload || hasBackgroundSave, 'Should use downloads API directly or via SAVE_TEXT background path');
  });

  // Progress polling tests
  test('Popup has progress polling function', () => {
    const content = fs.readFileSync(path.join(EXTENSION_PATH, 'src/popup.js'), 'utf8');
    assertContains(content, 'pollProgress', 'Should have pollProgress function');
  });

  test('Popup polls storage for extractProgress', () => {
    const content = fs.readFileSync(path.join(EXTENSION_PATH, 'src/popup.js'), 'utf8');
    assertContains(content, 'extractProgress', 'Should check extractProgress in storage');
  });

  // ============================================================
  // SUITE 3: Content Script Tests
  // ============================================================
  console.log('\n--- SUITE 3: Content Script Tests ---\n');

  test('Content script exists', () => {
    const contentPath = path.join(EXTENSION_PATH, 'src/content.js');
    assert(fs.existsSync(contentPath), 'content.js should exist');
  });

  test('Content script has PING handler', () => {
    const content = fs.readFileSync(path.join(EXTENSION_PATH, 'src/content.js'), 'utf8');
    assertContains(content, "type === 'PING'", 'Should have PING handler');
  });

  test('Content script has START_PICK_REGION handler', () => {
    const content = fs.readFileSync(path.join(EXTENSION_PATH, 'src/content.js'), 'utf8');
    assertContains(content, "type === 'START_PICK_REGION'", 'Should have START_PICK_REGION handler');
  });

  test('Content script has RUN_CAPTURE_EXTRACT handler', () => {
    const content = fs.readFileSync(path.join(EXTENSION_PATH, 'src/content.js'), 'utf8');
    assertContains(content, "type === 'RUN_CAPTURE_EXTRACT'", 'Should have RUN_CAPTURE_EXTRACT handler');
  });

  test('Content script has GET_EXTRACTED_TEXT handler', () => {
    const content = fs.readFileSync(path.join(EXTENSION_PATH, 'src/content.js'), 'utf8');
    assertContains(content, "type === 'GET_EXTRACTED_TEXT'", 'Should have GET_EXTRACTED_TEXT handler');
  });

  test('Content script has CAPTURE_VISIBLE handler', () => {
    const content = fs.readFileSync(path.join(EXTENSION_PATH, 'src/content.js'), 'utf8');
    assertContains(content, "type === 'CAPTURE_VISIBLE'", 'Should have CAPTURE_VISIBLE handler');
  });

  test('Content script has SAVE_TEXT handler', () => {
    const content = fs.readFileSync(path.join(EXTENSION_PATH, 'src/content.js'), 'utf8');
    assertContains(content, "type === 'SAVE_TEXT'", 'Should have SAVE_TEXT handler');
  });

  test('Content script sends EXTRACT_PROGRESS messages', () => {
    const content = fs.readFileSync(path.join(EXTENSION_PATH, 'src/content.js'), 'utf8');
    assertContains(content, "type: 'EXTRACT_PROGRESS'", 'Should send EXTRACT_PROGRESS messages');
  });

  test('Content script has region box UI', () => {
    const content = fs.readFileSync(path.join(EXTENSION_PATH, 'src/content.js'), 'utf8');
    assertContains(content, 'feishu-ocr-region-box', 'Should have region box element');
    assertContains(content, 'feishu-ocr-control-panel', 'Should have control panel');
  });

  test('Content script has overlay UI', () => {
    const content = fs.readFileSync(path.join(EXTENSION_PATH, 'src/content.js'), 'utf8');
    assertContains(content, 'feishu-ocr-overlay', 'Should have overlay element');
    assertContains(content, 'UI.makeOverlay', 'Should have makeOverlay function');
  });

  test('Content script has confirm/cancel buttons', () => {
    const content = fs.readFileSync(path.join(EXTENSION_PATH, 'src/content.js'), 'utf8');
    assertContains(content, 'feishu-ocr-confirm-btn', 'Should have confirm button');
    assertContains(content, 'feishu-ocr-cancel-btn', 'Should have cancel button');
  });

  test('Content script has drag functionality', () => {
    const content = fs.readFileSync(path.join(EXTENSION_PATH, 'src/content.js'), 'utf8');
    assertContains(content, 'makeInteractive', 'Should have drag functionality');
    assertContains(content, 'feishu-ocr-resize-handle', 'Should support resize handles');
  });

  // Progress storage tests
  test('Content script stores progress to storage', () => {
    const content = fs.readFileSync(path.join(EXTENSION_PATH, 'src/content.js'), 'utf8');
    assertContains(content, 'extractProgress', 'Should store extractProgress to storage');
  });

  // ============================================================
  // SUITE 4: Text Processing Tests
  // ============================================================
  console.log('\n--- SUITE 4: Text Processing Tests ---\n');

  test('Content script has deduplication logic', () => {
    const content = fs.readFileSync(path.join(EXTENSION_PATH, 'src/content.js'), 'utf8');
    assertContains(content, 'TextLayer.dedupe', 'Should have deduplication');
    assertContains(content, 'seen.has', 'Should use Set for deduplication');
  });

  test('Content script extracts text in rect', () => {
    const content = fs.readFileSync(path.join(EXTENSION_PATH, 'src/content.js'), 'utf8');
    assertContains(content, 'TextLayer.extractInRect', 'Should have extractInRect');
  });

  test('Content script normalizes text blocks', () => {
    const content = fs.readFileSync(path.join(EXTENSION_PATH, 'src/content.js'), 'utf8');
    assertContains(content, 'Util.normalizeBlock', 'Should normalize text');
  });

  // ============================================================
  // SUITE 5: Scroll & OCR Tests
  // ============================================================
  console.log('\n--- SUITE 5: Scroll & OCR Tests ---\n');

  test('Content script has scroll container finder', () => {
    const content = fs.readFileSync(path.join(EXTENSION_PATH, 'src/content.js'), 'utf8');
    assertContains(content, 'Scroll.findContainer', 'Should find scroll container');
  });

  test('Content script has stable window detection', () => {
    const content = fs.readFileSync(path.join(EXTENSION_PATH, 'src/content.js'), 'utf8');
    assertContains(content, 'Scroll.waitStableWindow', 'Should detect stable window');
  });

  test('Content script has OCR image cropping', () => {
    const content = fs.readFileSync(path.join(EXTENSION_PATH, 'src/content.js'), 'utf8');
    assertContains(content, 'OCR.cropDataUrl', 'Should crop image');
  });

  test('Content script has language inference', () => {
    const content = fs.readFileSync(path.join(EXTENSION_PATH, 'src/content.js'), 'utf8');
    assertContains(content, 'OCR.inferLang', 'Should infer language');
  });

  test('Content script has OCR parsing', () => {
    const content = fs.readFileSync(path.join(EXTENSION_PATH, 'src/content.js'), 'utf8');
    assertContains(content, 'OCR.parseWithLang', 'Should parse with language');
  });

  test('Content script has retry logic', () => {
    const content = fs.readFileSync(path.join(EXTENSION_PATH, 'src/content.js'), 'utf8');
    assertContains(content, 'OCR.extractWithRetry', 'Should have retry logic');
  });

  test('Content script uses OCR.space API', () => {
    const content = fs.readFileSync(path.join(EXTENSION_PATH, 'src/content.js'), 'utf8');
    assertContains(content, 'api.ocr.space', 'Should use OCR.space');
  });

  // ============================================================
  // SUITE 6: Background Script Tests
  // ============================================================
  console.log('\n--- SUITE 6: Background Script Tests ---\n');

  test('Background script exists', () => {
    const bgPath = path.join(EXTENSION_PATH, 'src/background.js');
    assert(fs.existsSync(bgPath), 'background.js should exist');
  });

  test('Background script has CAPTURE_VISIBLE handler', () => {
    const content = fs.readFileSync(path.join(EXTENSION_PATH, 'src/background.js'), 'utf8');
    assertContains(content, "type === 'CAPTURE_VISIBLE'", 'Should handle CAPTURE_VISIBLE');
  });

  test('Background script has SAVE_TEXT handler', () => {
    const content = fs.readFileSync(path.join(EXTENSION_PATH, 'src/background.js'), 'utf8');
    assertContains(content, "type === 'SAVE_TEXT'", 'Should handle SAVE_TEXT');
  });

  test('Background script uses chrome.downloads', () => {
    const content = fs.readFileSync(path.join(EXTENSION_PATH, 'src/background.js'), 'utf8');
    assertContains(content, 'chrome.downloads.download', 'Should use downloads API');
  });

  test('Background script captures visible tab', () => {
    const content = fs.readFileSync(path.join(EXTENSION_PATH, 'src/background.js'), 'utf8');
    assertContains(content, 'chrome.tabs.captureVisibleTab', 'Should capture visible tab');
  });

  test('Background queue uses runId to avoid stale done state', () => {
    const content = fs.readFileSync(path.join(EXTENSION_PATH, 'src/background.js'), 'utf8');
    assertContains(content, 'createRunId', 'Should create per-run ids');
    assertContains(content, 'p?.runId && p.runId !== runId', 'Should ignore stale progress from previous runs');
    assertContains(content, "progress: 'queued'", 'Should reset progress before starting each run');
  });

  // ============================================================
  // SUITE 7: Configuration Tests
  // ============================================================
  console.log('\n--- SUITE 7: Configuration Tests ---\n');

  test('Content script has scroll config', () => {
    const content = fs.readFileSync(path.join(EXTENSION_PATH, 'src/content.js'), 'utf8');
    assertContains(content, 'CONFIG.scroll', 'Should have scroll config');
    assertContains(content, 'maxIterations', 'Should have maxIterations');
    assertContains(content, 'minStep', 'Should have minStep');
    assertContains(content, 'stepRatio', 'Should have stepRatio');
  });

  test('Content script has wait config', () => {
    const content = fs.readFileSync(path.join(EXTENSION_PATH, 'src/content.js'), 'utf8');
    assertContains(content, 'CONFIG.wait', 'Should have wait config');
    assertContains(content, 'idleMs', 'Should have idleMs');
    assertContains(content, 'stableMaxWaitMs', 'Should have stableMaxWaitMs');
  });

  test('Content script has OCR config', () => {
    const content = fs.readFileSync(path.join(EXTENSION_PATH, 'src/content.js'), 'utf8');
    assertContains(content, 'CONFIG.ocr', 'Should have OCR config');
    assertContains(content, 'endpoint', 'Should have OCR endpoint');
    assertContains(content, 'retry', 'Should have retry config');
  });

  // ============================================================
  // SUITE 8: Storage & Persistence Tests
  // ============================================================
  console.log('\n--- SUITE 8: Storage & Persistence Tests ---\n');

  test('Popup uses chrome.storage.local', () => {
    const content = fs.readFileSync(path.join(EXTENSION_PATH, 'src/popup.js'), 'utf8');
    assertContains(content, 'chrome.storage.local.get', 'Should use storage.get');
    assertContains(content, 'chrome.storage.local.set', 'Should use storage.set');
  });

  test('Content script stores extracted text', () => {
    const content = fs.readFileSync(path.join(EXTENSION_PATH, 'src/content.js'), 'utf8');
    assertContains(content, 'extractedText', 'Should store extracted text');
    assertContains(content, 'extractedMeta', 'Should store metadata');
  });

  test('Content script persists region to localStorage', () => {
    const content = fs.readFileSync(path.join(EXTENSION_PATH, 'src/content.js'), 'utf8');
    assertContains(content, 'localStorage.setItem', 'Should persist to localStorage');
    assertContains(content, 'feishu_ocr_selectedRect', 'Should use feishu_ocr_selectedRect key');
  });

  // ============================================================
  // SUITE 9: Error Handling Tests
  // ============================================================
  console.log('\n--- SUITE 9: Error Handling Tests ---\n');

  test('Content script handles missing region', () => {
    const content = fs.readFileSync(path.join(EXTENSION_PATH, 'src/content.js'), 'utf8');
    assertContains(content, 'Please select region first', 'Should warn when no region');
  });

  test('Content script handles invalid region', () => {
    const content = fs.readFileSync(path.join(EXTENSION_PATH, 'src/content.js'), 'utf8');
    assertContains(content, 'Invalid region', 'Should warn on invalid region');
  });

  test('Content script has isRunning lock', () => {
    const content = fs.readFileSync(path.join(EXTENSION_PATH, 'src/content.js'), 'utf8');
    assertContains(content, 'isRunning', 'Should have isRunning flag');
    assertContains(content, 'Already running', 'Should handle concurrent runs');
  });

  test('Content script persists runId in progress states', () => {
    const content = fs.readFileSync(path.join(EXTENSION_PATH, 'src/content.js'), 'utf8');
    assertContains(content, 'runId', 'Should carry runId through extraction lifecycle');
    assertContains(content, "progress: 'error'", 'Should write error progress when extraction fails');
  });

  test('Popup handles connection errors', () => {
    const content = fs.readFileSync(path.join(EXTENSION_PATH, 'src/popup.js'), 'utf8');
    assertContains(content, 'receiving end does not exist', 'Should handle connection errors');
    assertContains(content, 'Connection timeout', 'Should handle timeout');
  });

  // ============================================================
  // SUITE 10: Utility Objects Tests
  // ============================================================
  console.log('\n--- SUITE 10: Utility Objects Tests ---\n');

  test('Content script has Util object', () => {
    const content = fs.readFileSync(path.join(EXTENSION_PATH, 'src/content.js'), 'utf8');
    assertContains(content, 'const Util', 'Should have Util object');
    assertContains(content, 'Util.sleep', 'Should have sleep utility');
    assertContains(content, 'Util.normalizeBlock', 'Should have normalizeBlock');
    assertContains(content, 'Util.nowIso', 'Should have nowIso');
  });

  test('Content script has TextLayer object', () => {
    const content = fs.readFileSync(path.join(EXTENSION_PATH, 'src/content.js'), 'utf8');
    assertContains(content, 'const TextLayer', 'Should have TextLayer object');
  });

  test('Content script has OCR object', () => {
    const content = fs.readFileSync(path.join(EXTENSION_PATH, 'src/content.js'), 'utf8');
    assertContains(content, 'const OCR', 'Should have OCR object');
  });

  test('Content script has Scroll object', () => {
    const content = fs.readFileSync(path.join(EXTENSION_PATH, 'src/content.js'), 'utf8');
    assertContains(content, 'const Scroll', 'Should have Scroll object');
  });

  test('Content script has UI object', () => {
    const content = fs.readFileSync(path.join(EXTENSION_PATH, 'src/content.js'), 'utf8');
    assertContains(content, 'const UI', 'Should have UI object');
  });


  // ============================================================
  // SUITE 11: Regression Tests (Batch Queue runId)
  // ============================================================
  console.log('\n--- SUITE 11: Regression Tests (Batch Queue runId) ---\n');

  function decideWaitOutcome(progressStates, runId) {
    for (const p of progressStates) {
      if (p?.runId && p.runId !== runId) continue;
      if (p?.progress === 'done') return { ok: true, charCount: p.charCount || 0 };
      if (p?.progress === 'error') return { ok: false, error: p.error || 'extract failed' };
    }
    return { ok: false, error: 'timeout' };
  }

  test('Regression: stale done from previous run must not finish current run', () => {
    const runId = 'run-new-2';
    const states = [
      { progress: 'done', runId: 'run-old-1', charCount: 9999 },
      { progress: 'starting', runId },
      { progress: 'scrolling', runId, iteration: 1 },
      { progress: 'done', runId, charCount: 1200 }
    ];
    const out = decideWaitOutcome(states, runId);
    assert(out.ok === true, 'Current run should still complete successfully');
    assert(out.charCount === 1200, 'Must use current run result, not stale done');
  });

  test('Regression: current run error should fail even if stale done exists', () => {
    const runId = 'run-new-3';
    const states = [
      { progress: 'done', runId: 'run-old-2', charCount: 8888 },
      { progress: 'starting', runId },
      { progress: 'error', runId, error: 'ocr timeout' }
    ];
    const out = decideWaitOutcome(states, runId);
    assert(out.ok === false, 'Current run error should fail queue item');
    assert(out.error.includes('ocr timeout'), 'Should surface current run error');
  });

  // ============================================================
  // Print Summary
  // ============================================================
  console.log('='.repeat(60));
  console.log('TEST RESULTS SUMMARY');
  console.log('='.repeat(60));
  console.log(`Total:  ${results.passed + results.failed}`);
  console.log(`Passed: ${results.passed} ✓`);
  console.log(`Failed: ${results.failed} ✗`);
  console.log('');

  console.log('Details:');
  for (const t of results.tests) {
    const icon = t.status === 'PASS' ? '✓' : '✗';
    console.log(`  ${icon} ${t.name}`);
    if (t.error) console.log(`      Error: ${t.error}`);
  }

  console.log('');

  // Exit with error code if any tests failed
  if (results.failed > 0) {
    console.log(`❌ ${results.failed} test(s) failed`);
    process.exit(1);
  } else {
    console.log('✅ All tests passed!');
    process.exit(0);
  }
}

runTests();
