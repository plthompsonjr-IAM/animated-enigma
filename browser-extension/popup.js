const btn = document.getElementById('scan-btn');
const statusEl = document.getElementById('status');
const resultsEl = document.getElementById('results');
const urlBadge = document.getElementById('url-badge');

btn.addEventListener('click', analyze);

async function analyze() {
  btn.disabled = true;
  btn.textContent = 'Scanning...';
  statusEl.textContent = 'Injecting analyzer...';
  resultsEl.style.display = 'none';

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    urlBadge.textContent = new URL(tab.url).hostname;

    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['analyzer.js'],
    });

    renderResults(result);
  } catch (err) {
    statusEl.textContent = 'Error: ' + err.message;
  } finally {
    btn.disabled = false;
    btn.textContent = 'Analyze Page';
  }
}

function renderResults(data) {
  statusEl.textContent = '';
  resultsEl.style.display = 'block';
  resultsEl.innerHTML = '';

  const totalFindings =
    data.authorAttributions.length +
    data.thirdPartyLibraries.length +
    data.licenses.length +
    data.cdnResources.length +
    data.otherIndicators.length;

  // Verdict banner
  const verdict = document.createElement('div');
  verdict.className = 'verdict';
  if (totalFindings === 0) {
    verdict.classList.add('clean');
    verdict.textContent = 'No external authorship indicators found.';
  } else if (data.authorAttributions.length > 0 || data.thirdPartyLibraries.length > 0) {
    verdict.classList.add('flagged');
    verdict.textContent = `${totalFindings} authorship indicator(s) found — likely contains external code.`;
  } else {
    verdict.classList.add('uncertain');
    verdict.textContent = `${totalFindings} indicator(s) found — review details below.`;
  }
  resultsEl.appendChild(verdict);

  // Author attributions
  if (data.authorAttributions.length > 0) {
    appendSection('Author Attributions', data.authorAttributions.map(a => ({
      name: a.label,
      detail: a.value,
      tagClass: 'author',
    })));
  }

  // Third-party libraries
  if (data.thirdPartyLibraries.length > 0) {
    appendSection('Third-Party Libraries', data.thirdPartyLibraries.map(lib => ({
      name: lib.name,
      detail: lib.sources.slice(0, 2).join(', '),
      tagClass: 'library',
    })));
  }

  // CDN resources
  if (data.cdnResources.length > 0) {
    appendSection('CDN Resources', data.cdnResources.map(cdn => ({
      name: cdn.host,
      detail: cdn.urls.slice(0, 2).join(', '),
      tagClass: 'cdn',
    })));
  }

  // Licenses
  if (data.licenses.length > 0) {
    appendSection('License Mentions', data.licenses.map(l => ({
      name: l,
      detail: null,
      tagClass: 'license',
    })));
  }

  // Platform indicators
  if (data.otherIndicators.length > 0) {
    appendSection('Platform Indicators', data.otherIndicators.map(o => ({
      name: o,
      detail: null,
      tagClass: 'platform',
    })));
  }

  if (totalFindings === 0) {
    const empty = document.createElement('div');
    empty.className = 'section';
    empty.innerHTML = '<p class="empty">No author comments, third-party libraries, CDN links, licenses, or platform markers detected in this page\'s source.</p>';
    resultsEl.appendChild(empty);
  }
}

function appendSection(title, items) {
  const section = document.createElement('div');
  section.className = 'section';
  section.innerHTML = `<div class="section-title">${title}</div>`;

  for (const item of items) {
    const div = document.createElement('div');
    div.className = 'item';
    div.innerHTML = `
      <span class="tag ${item.tagClass}">${title.replace(/s$/, '')}</span>
      <span class="name">${escHtml(item.name)}</span>
      ${item.detail ? `<div class="detail">${escHtml(item.detail)}</div>` : ''}
    `;
    section.appendChild(div);
  }

  resultsEl.appendChild(section);
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
