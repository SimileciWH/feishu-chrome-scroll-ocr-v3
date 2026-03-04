const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');

const EXTENSION_PATH = path.join(__dirname, '..');

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runTests() {
  console.log('Starting Chrome extension automated tests...\n');
  console.log('='.repeat(50));
  
  const results = {
    passed: 0,
    failed: 0,
    tests: []
  };

  let browser;
  try {
    // Load Chrome with extension
    browser = await puppeteer.launch({
      headless: false,
      args: [
        `--disable-extensions-except=${EXTENSION_PATH}`,
        `--load-extension=${EXTENSION_PATH}`,
        '--no-sandbox',
        '--disable-setuid-sandbox'
      ]
    });

    const pages = await browser.pages();
    const page = pages[0];

    // ============================================
    // TEST 1: Manifest Validation
    // ============================================
    console.log('TEST 1: Manifest validation');
    try {
      const manifest = JSON.parse(fs.readFileSync(path.join(EXTENSION_PATH, 'manifest.json'), 'utf8'));
      
      const checks = [
        { name: 'manifest_version is 3', pass: manifest.manifest_version === 3 },
        { name: 'has permissions', pass: manifest.permissions?.length > 0 },
        { name: 'has content_scripts', pass: manifest.content_scripts?.length > 0 },
        { name: 'has background service_worker', pass: manifest.background?.service_worker },
        { name: 'has popup', pass: manifest.action?.default_popup },
      ];
      
      for (const check of checks) {
        if (check.pass) {
          results.passed++;
          console.log(`  ✓ ${check.name}`);
        } else {
          results.failed++;
          console.log(`  ✗ ${check.name}`);
        }
        results.tests.push({ name: check.name, status: check.pass ? 'PASS' : 'FAIL' });
      }
    } catch (e) {
      results.failed += 5;
      console.log(`  ✗ Manifest error: ${e.message}`);
      results.tests.push({ name: 'Manifest validation', status: 'FAIL', error: e.message });
    }

    // ============================================
    // TEST 2: Popup HTML Structure
    // ============================================
    console.log('\nTEST 2: Popup HTML structure');
    try {
      const popupUrl = `file://${EXTENSION_PATH}/src/popup.html`;
      await page.goto(popupUrl, { waitUntil: 'domcontentloaded' });
      await sleep(500);
      
      const requiredIds = ['status', 'apiKey', 'save', 'pick', 'run', 'copy', 'download'];
      for (const id of requiredIds) {
        const el = await page.$(`#${id}`);
        if (el) {
          results.passed++;
          console.log(`  ✓ #${id} exists`);
          results.tests.push({ name: `popup #${id}`, status: 'PASS' });
        } else {
          results.failed++;
          console.log(`  ✗ #${id} missing`);
          results.tests.push({ name: `popup #${id}`, status: 'FAIL' });
        }
      }
    } catch (e) {
      results.failed++;
      console.log(`  ✗ Popup error: ${e.message}`);
      results.tests.push({ name: 'Popup HTML', status: 'FAIL', error: e.message });
    }

    // ============================================
    // TEST 3: Content Script Structure
    // ============================================
    console.log('\nTEST 3: Content script structure');
    try {
      const contentScript = fs.readFileSync(path.join(EXTENSION_PATH, 'src/content.js'), 'utf8');
      
      const required = [
        { name: 'has message listener', pass: contentScript.includes('chrome.runtime.onMessage') },
        { name: 'has PING handler', pass: contentScript.includes("type === 'PING'") },
        { name: 'has START_PICK_REGION', pass: contentScript.includes("type === 'START_PICK_REGION'") },
        { name: 'has RUN_CAPTURE_EXTRACT', pass: contentScript.includes("type === 'RUN_CAPTURE_EXTRACT'") },
        { name: 'has UI.pickRegion', pass: contentScript.includes('UI.pickRegion') },
        { name: 'has runCaptureExtract', pass: contentScript.includes('runCaptureExtract') },
        { name: 'has localStorage persistence', pass: contentScript.includes('localStorage') },
        { name: 'has selectedRect check', pass: contentScript.includes('selectedRect') },
      ];
      
      for (const check of required) {
        if (check.pass) {
          results.passed++;
          console.log(`  ✓ ${check.name}`);
          results.tests.push({ name: check.name, status: 'PASS' });
        } else {
          results.failed++;
          console.log(`  ✗ ${check.name}`);
          results.tests.push({ name: check.name, status: 'FAIL' });
        }
      }
    } catch (e) {
      results.failed++;
      console.log(`  ✗ Content script error: ${e.message}`);
      results.tests.push({ name: 'Content script', status: 'FAIL', error: e.message });
    }

    // ============================================
    // TEST 4: Background Script Structure
    // ============================================
    console.log('\nTEST 4: Background script structure');
    try {
      const bgScript = fs.readFileSync(path.join(EXTENSION_PATH, 'src/background.js'), 'utf8');
      
      const required = [
        { name: 'has message listener', pass: bgScript.includes('chrome.runtime.onMessage') },
        { name: 'has CAPTURE_VISIBLE handler', pass: bgScript.includes("type === 'CAPTURE_VISIBLE'") },
        { name: 'has SAVE_TEXT handler', pass: bgScript.includes("type === 'SAVE_TEXT'") },
      ];
      
      for (const check of required) {
        if (check.pass) {
          results.passed++;
          console.log(`  ✓ ${check.name}`);
          results.tests.push({ name: check.name, status: 'PASS' });
        } else {
          results.failed++;
          console.log(`  ✗ ${check.name}`);
          results.tests.push({ name: check.name, status: 'FAIL' });
        }
      }
    } catch (e) {
      results.failed++;
      console.log(`  ✗ Background script error: ${e.message}`);
      results.tests.push({ name: 'Background script', status: 'FAIL', error: e.message });
    }

    // ============================================
    // TEST 5: Popup JS Logic
    // ============================================
    console.log('\nTEST 5: Popup JS logic');
    try {
      const popupJS = fs.readFileSync(path.join(EXTENSION_PATH, 'src/popup.js'), 'utf8');
      
      const required = [
        { name: 'has sendToActiveTab', pass: popupJS.includes('sendToActiveTab') },
        { name: 'has safeSendMessage', pass: popupJS.includes('safeSendMessage') },
        { name: 'has PING before extract', pass: popupJS.includes("type: 'PING'") },
        { name: 'has timeout handling', pass: popupJS.includes('timeout') },
        { name: 'has GET_EXTRACTED_TEXT', pass: popupJS.includes("type: 'GET_EXTRACTED_TEXT'") },
      ];
      
      for (const check of required) {
        if (check.pass) {
          results.passed++;
          console.log(`  ✓ ${check.name}`);
          results.tests.push({ name: check.name, status: 'PASS' });
        } else {
          results.failed++;
          console.log(`  ✗ ${check.name}`);
          results.tests.push({ name: check.name, status: 'FAIL' });
        }
      }
    } catch (e) {
      results.failed++;
      console.log(`  ✗ Popup JS error: ${e.message}`);
      results.tests.push({ name: 'Popup JS', status: 'FAIL', error: e.message });
    }

  } catch (e) {
    console.error('\nTest error:', e);
  } finally {
    if (browser) await browser.close();
  }

  // Print summary
  console.log('\n' + '='.repeat(50));
  console.log('TEST RESULTS SUMMARY');
  console.log('='.repeat(50));
  console.log(`Total: ${results.passed + results.failed}`);
  console.log(`Passed: ${results.passed}`);
  console.log(`Failed: ${results.failed}`);
  console.log('');
  
  // Exit with error code if any tests failed
  if (results.failed > 0) {
    console.log('\n❌ TESTS FAILED');
    process.exit(1);
  } else {
    console.log('\n✅ ALL TESTS PASSED');
    process.exit(0);
  }
}

runTests().catch(console.error);
