// Self-integrity verification service worker.
// Computes SHA-256 of each protected file at startup and compares against
// hardcoded expected values. If any file has been tampered with, the popup
// is disabled and all future analysis is blocked.

const EXPECTED = {
  'analyzer.js':  'd08051385b274238ffe4dac569ce58a9e537bda2e2063864c375e5a4c363016f',
  'popup.js':     'c65a725319f31dfbe2c50a2ae0043fa00bc09d45be88770197ec48493b639718',
  'popup.html':   '9be7ecf72e7982de33ed58a82d8fd00f1b284c14826f1fc88d8571cbe45c8343',
  'manifest.json':'677682a4a724650796f732dd8d3a70a7d56eedd8033fc8ae8304761e802e9772',
};

async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function verifyIntegrity() {
  const tampered = [];

  for (const [file, expected] of Object.entries(EXPECTED)) {
    try {
      const url = chrome.runtime.getURL(file);
      const resp = await fetch(url);
      const text = await resp.text();
      const actual = await sha256(text);
      if (actual !== expected) {
        tampered.push(file);
      }
    } catch (err) {
      tampered.push(file + ' (unreadable)');
    }
  }

  if (tampered.length > 0) {
    console.error('[Authorship Analyzer] INTEGRITY FAILURE — tampered files:', tampered);
    // Disable the popup so the extension cannot be used
    chrome.action.setPopup({ popup: '' });
    chrome.action.setTitle({ title: `LOCKED: Tampered files detected (${tampered.join(', ')})` });
    chrome.action.setBadgeText({ text: '!' });
    chrome.action.setBadgeBackgroundColor({ color: '#dc2626' });
  } else {
    console.log('[Authorship Analyzer] Integrity OK');
    chrome.action.setPopup({ popup: 'popup.html' });
    chrome.action.setTitle({ title: 'Analyze Page Authorship' });
    chrome.action.setBadgeText({ text: '' });
  }
}

// Run on every service-worker startup (install, update, browser start)
chrome.runtime.onInstalled.addListener(verifyIntegrity);
chrome.runtime.onStartup.addListener(verifyIntegrity);
verifyIntegrity();
