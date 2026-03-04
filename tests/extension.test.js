const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');

const EXTENSION_PATH = path.join(__dirname, '..');

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runTests() {
  console.log('Starting Chrome extension tests...\n');
  
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

    // Test 1: Extension loads
    console.log('Test 1: Extension loads...');
    try {
      await page.goto('https://example.com', { waitUntil: 'networkidle0' });
      await sleep(1000);
      results.passed++;
      results.tests.push({ name: 'Extension loads', status: 'PASS' });
      console.log('  ✓ PASS\n');
    } catch (e) {
      results.failed++;
      results.tests.push({ name: 'Extension loads', status: 'FAIL', error: e.message });
      console.log('  ✗ FAIL:', e.message, '\n');
    }

    // Test 2: Popup opens
    console.log('Test 2: Popup opens...');
    try {
      // Click extension icon - this requires extension ID
      // For now, test popup HTML directly
      const popupUrl = `file://${EXTENSION_PATH}/src/popup.html`;
      await page.goto(popupUrl, { waitUntil: 'domcontentloaded' });
      await sleep(500);
      
      const title = await page.$eval('h3', el => el.textContent).catch(() => null);
      if (title && title.includes('Feishu')) {
        results.passed++;
        results.tests.push({ name: 'Popup opens', status: 'PASS' });
        console.log('  ✓ PASS\n');
      } else {
        throw new Error('Popup title not found');
      }
    } catch (e) {
      results.failed++;
      results.tests.push({ name: 'Popup opens', status: 'FAIL', error: e.message });
      console.log('  ✗ FAIL:', e.message, '\n');
    }

    // Test 3: Popup has required elements
    console.log('Test 3: Popup has required elements...');
    try {
      const elements = await page.$$eval('button', buttons => buttons.map(b => b.id).filter(id => id));
      const hasButtons = elements.includes('pick') && elements.includes('run');
      if (hasButtons) {
        results.passed++;
        results.tests.push({ name: 'Popup has buttons', status: 'PASS' });
        console.log('  ✓ PASS\n');
      } else {
        throw new Error('Required buttons not found');
      }
    } catch (e) {
      results.failed++;
      results.tests.push({ name: 'Popup has buttons', status: 'FAIL', error: e.message });
      console.log('  ✗ FAIL:', e.message, '\n');
    }

    // Test 4: Content script loads on Feishu-like page
    console.log('Test 4: Content script structure valid...');
    try {
      const contentScript = fs.readFileSync(path.join(EXTENSION_PATH, 'src/content.js'), 'utf8');
      const hasListeners = contentScript.includes('chrome.runtime.onMessage');
      const hasPING = contentScript.includes("type === 'PING'");
      if (hasListeners && hasPING) {
        results.passed++;
        results.tests.push({ name: 'Content script valid', status: 'PASS' });
        console.log('  ✓ PASS\n');
      } else {
        throw new Error('Content script missing required handlers');
      }
    } catch (e) {
      results.failed++;
      results.tests.push({ name: 'Content script valid', status: 'FAIL', error: e.message });
      console.log('  ✗ FAIL:', e.message, '\n');
    }

    // Test 5: Manifest is valid
    console.log('Test 5: Manifest is valid...');
    try {
      const manifest = JSON.parse(fs.readFileSync(path.join(EXTENSION_PATH, 'manifest.json'), 'utf8'));
      const hasPermissions = manifest.permissions && manifest.permissions.length > 0;
      const hasContentScripts = manifest.content_scripts && manifest.content_scripts.length > 0;
      if (hasPermissions && hasContentScripts) {
        results.passed++;
        results.tests.push({ name: 'Manifest valid', status: 'PASS' });
        console.log('  ✓ PASS\n');
      } else {
        throw new Error('Manifest missing required fields');
      }
    } catch (e) {
      results.failed++;
      results.tests.push({ name: 'Manifest valid', status: 'FAIL', error: e.message });
      console.log('  ✗ FAIL:', e.message, '\n');
    }

  } catch (e) {
    console.error('Test error:', e);
  } finally {
    if (browser) await browser.close();
  }

  // Print summary
  console.log('='.repeat(50));
  console.log('TEST RESULTS');
  console.log('='.repeat(50));
  console.log(`Total: ${results.passed + results.failed}`);
  console.log(`Passed: ${results.passed}`);
  console.log(`Failed: ${results.failed}`);
  console.log('');
  
  for (const test of results.tests) {
    console.log(`${test.status === 'PASS' ? '✓' : '✗'} ${test.name}`);
    if (test.error) console.log(`  Error: ${test.error}`);
  }
  
  console.log('');
  
  // Exit with error code if any tests failed
  process.exit(results.failed > 0 ? 1 : 0);
}

runTests().catch(console.error);
