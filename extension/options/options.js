/**
 * Options Page Script - Settings management for AI Content Checker
 */

'use strict';

// ===== Navigation =====

function switchTab(tabId) {
  document.querySelectorAll('.nav-item').forEach(item => {
    item.classList.toggle('active', item.dataset.tab === tabId);
  });
  document.querySelectorAll('.tab-content').forEach(content => {
    content.classList.toggle('active', content.id === `tab-${tabId}`);
  });
}

// ===== Utility =====

function escapeHtml(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function formatDate(ts) {
  return new Date(ts).toLocaleString('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit'
  });
}

function getScoreChipClass(score) {
  if (score >= 80) return 'danger';
  if (score >= 60) return 'warning';
  if (score >= 40) return 'caution';
  if (score >= 20) return 'ok';
  return 'safe';
}

function showSaveStatus(elementId, message = '已保存 / Saved ✓') {
  const el = document.getElementById(elementId);
  el.textContent = message;
  el.style.color = '#22c55e';
  setTimeout(() => { el.textContent = ''; }, 3000);
}

// ===== General Settings =====

async function loadGeneralSettings() {
  const { settings } = await chrome.storage.local.get('settings');
  if (!settings) return;

  const scope = settings.defaultScope || {};
  document.getElementById('default-text').checked = scope.text !== false;
  document.getElementById('default-images').checked = scope.images !== false;
  document.getElementById('default-videos').checked = scope.videos !== false;

  const thresholds = settings.thresholds || {};
  document.getElementById('threshold-warning').value = thresholds.warning || 40;
  document.getElementById('threshold-warning-val').textContent = thresholds.warning || 40;
  document.getElementById('threshold-danger').value = thresholds.danger || 70;
  document.getElementById('threshold-danger-val').textContent = thresholds.danger || 70;

  document.getElementById('max-history').value = settings.maxHistory || 500;
}

async function saveGeneralSettings() {
  const { settings = {} } = await chrome.storage.local.get('settings');

  settings.defaultScope = {
    text: document.getElementById('default-text').checked,
    images: document.getElementById('default-images').checked,
    videos: document.getElementById('default-videos').checked
  };

  settings.thresholds = {
    warning: parseInt(document.getElementById('threshold-warning').value),
    danger: parseInt(document.getElementById('threshold-danger').value)
  };

  settings.maxHistory = parseInt(document.getElementById('max-history').value);

  await chrome.storage.local.set({ settings });
  showSaveStatus('save-status-general');
}

// ===== Whitelist / Blacklist =====

async function loadList(listName) {
  const { [listName]: list = [] } = await chrome.storage.local.get(listName);
  renderList(listName, list);
}

function renderList(listName, list) {
  const containerId = `${listName}-entries`;
  const container = document.getElementById(containerId);

  if (!list || list.length === 0) {
    const emptyLabel = listName === 'whitelist' ? '白名单为空 / Whitelist is empty' : '黑名单为空 / Blacklist is empty';
    container.innerHTML = `<div class="empty-state">${emptyLabel}</div>`;
    return;
  }

  container.innerHTML = list.map(entry => `
    <div class="list-entry" data-pattern="${escapeHtml(entry.pattern)}">
      <div class="entry-pattern">${escapeHtml(entry.pattern)}</div>
      <div class="entry-note">${escapeHtml(entry.note || '')}</div>
      <div class="entry-date">${entry.addedAt ? formatDate(entry.addedAt) : ''}</div>
      <button class="btn-remove" data-list="${listName}" data-pattern="${escapeHtml(entry.pattern)}">
        删除 / Remove
      </button>
    </div>
  `).join('');

  // Attach remove event listeners
  container.querySelectorAll('.btn-remove').forEach(btn => {
    btn.addEventListener('click', async () => {
      const pattern = btn.dataset.pattern;
      await chrome.runtime.sendMessage({ type: 'REMOVE_FROM_LIST', list: listName, pattern });
      await loadList(listName);
    });
  });
}

async function addToList(listName) {
  const patternInput = document.getElementById(`${listName}-pattern-input`);
  const noteInput = document.getElementById(`${listName}-note-input`);

  const pattern = patternInput.value.trim();
  const note = noteInput.value.trim();

  if (!pattern) {
    patternInput.focus();
    return;
  }

  const result = await chrome.runtime.sendMessage({
    type: 'ADD_TO_LIST',
    list: listName,
    pattern,
    note
  });

  if (result?.success) {
    patternInput.value = '';
    noteInput.value = '';
    await loadList(listName);
  }
}

// ===== API Keys =====

async function loadApiKeys() {
  const { settings } = await chrome.storage.local.get('settings');
  const apiKeys = settings?.apiKeys || {};

  document.getElementById('api-gptzero').value = apiKeys.gptzero || '';
  document.getElementById('api-originality').value = apiKeys.originality || '';
  document.getElementById('api-hive').value = apiKeys.hive || '';
}

async function saveApiKeys() {
  const { settings = {} } = await chrome.storage.local.get('settings');

  settings.apiKeys = {
    gptzero: document.getElementById('api-gptzero').value.trim(),
    originality: document.getElementById('api-originality').value.trim(),
    hive: document.getElementById('api-hive').value.trim()
  };

  await chrome.storage.local.set({ settings });
  showSaveStatus('save-status-api');
}

// ===== History =====

async function loadHistory() {
  const typeFilter = document.getElementById('history-filter-type').value;
  const scoreFilter = document.getElementById('history-filter-score').value;

  const { history = [] } = await chrome.storage.local.get('history');

  let filtered = history;

  if (typeFilter) {
    filtered = filtered.filter(h => h.contentType === typeFilter);
  }

  if (scoreFilter === 'high') {
    filtered = filtered.filter(h => (h.score || 0) >= 70);
  } else if (scoreFilter === 'medium') {
    filtered = filtered.filter(h => (h.score || 0) >= 40 && (h.score || 0) < 70);
  } else if (scoreFilter === 'low') {
    filtered = filtered.filter(h => (h.score || 0) < 40);
  }

  renderHistory(filtered);
}

function renderHistory(history) {
  const container = document.getElementById('history-entries');

  if (!history || history.length === 0) {
    container.innerHTML = '<div class="empty-state">暂无符合条件的记录 / No matching records</div>';
    return;
  }

  const typeIcons = {
    text: '📝', image: '🖼️', images: '🖼️',
    video: '🎬', videos: '🎬', full: '📄'
  };

  const table = document.createElement('table');
  table.className = 'history-table';
  table.innerHTML = `
    <thead>
      <tr>
        <th>时间 / Time</th>
        <th>URL</th>
        <th>类型 / Type</th>
        <th>分数 / Score</th>
        <th>方法 / Method</th>
      </tr>
    </thead>
    <tbody>
      ${history.slice(0, 200).map(item => {
        const score = item.score || 0;
        const chipClass = getScoreChipClass(score);
        const typeIcon = typeIcons[item.contentType] || '📄';
        return `
          <tr>
            <td style="white-space:nowrap">${formatDate(item.timestamp)}</td>
            <td class="url-cell" title="${escapeHtml(item.url)}">
              <a href="${escapeHtml(item.url)}" target="_blank" style="color:#3b82f6;text-decoration:none">
                ${escapeHtml(item.url.replace(/^https?:\/\//, '').slice(0, 50))}
              </a>
            </td>
            <td>${typeIcon} ${item.contentType || '-'}</td>
            <td><span class="score-chip ${chipClass}">${score}</span></td>
            <td style="font-size:11px;color:#94a3b8">${item.method || '-'}</td>
          </tr>
        `;
      }).join('')}
    </tbody>
  `;

  container.innerHTML = '';
  container.appendChild(table);
}

// ===== Init =====

document.addEventListener('DOMContentLoaded', async () => {
  // Navigation
  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', () => {
      const tabId = item.dataset.tab;
      switchTab(tabId);
      if (tabId === 'history') loadHistory();
    });
  });

  // Load initial data
  await Promise.all([
    loadGeneralSettings(),
    loadList('whitelist'),
    loadList('blacklist'),
    loadApiKeys()
  ]);

  // General settings
  document.getElementById('btn-save-general').addEventListener('click', saveGeneralSettings);

  // Range sliders
  document.getElementById('threshold-warning').addEventListener('input', function() {
    document.getElementById('threshold-warning-val').textContent = this.value;
  });
  document.getElementById('threshold-danger').addEventListener('input', function() {
    document.getElementById('threshold-danger-val').textContent = this.value;
  });

  // Clear history
  document.getElementById('btn-clear-all-history').addEventListener('click', async () => {
    if (confirm('确认清除所有检测记录？/ Clear all scan history?')) {
      await chrome.storage.local.set({ history: [] });
      alert('历史记录已清除 / History cleared');
    }
  });

  // Whitelist
  document.getElementById('btn-add-whitelist').addEventListener('click', () => addToList('whitelist'));
  document.getElementById('whitelist-pattern-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') addToList('whitelist');
  });

  // Blacklist
  document.getElementById('btn-add-blacklist').addEventListener('click', () => addToList('blacklist'));
  document.getElementById('blacklist-pattern-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') addToList('blacklist');
  });

  // API keys
  document.getElementById('btn-save-api').addEventListener('click', saveApiKeys);

  // Toggle API key visibility
  document.querySelectorAll('.btn-toggle-visibility').forEach(btn => {
    btn.addEventListener('click', () => {
      const targetId = btn.dataset.target;
      const input = document.getElementById(targetId);
      input.type = input.type === 'password' ? 'text' : 'password';
      btn.textContent = input.type === 'password' ? '👁' : '🙈';
    });
  });

  // History filters
  document.getElementById('history-filter-type').addEventListener('change', loadHistory);
  document.getElementById('history-filter-score').addEventListener('change', loadHistory);
  document.getElementById('btn-clear-history-page').addEventListener('click', async () => {
    if (confirm('确认清除所有检测记录？/ Clear all scan history?')) {
      await chrome.storage.local.set({ history: [] });
      await loadHistory();
    }
  });
});
