/**
 * Popup Script - Main UI logic for AI Content Checker
 */

'use strict';

// ===== State =====
let currentTab = null;
let scanResults = null;
let selectionModeActive = false;
let selectedText = '';
let showingHistory = false;

// ===== Utility Functions =====

function getScoreLabel(score) {
  if (score >= 80) return { label: '极可能是AI生成 / Very likely AI', level: 'danger' };
  if (score >= 60) return { label: '可能是AI生成 / Likely AI', level: 'warning' };
  if (score >= 40) return { label: '部分可能是AI生成 / Possibly AI', level: 'caution' };
  if (score >= 20) return { label: '可能不是AI生成 / Unlikely AI', level: 'ok' };
  return { label: '很可能不是AI生成 / Very unlikely AI', level: 'safe' };
}

function formatUrl(url) {
  try {
    const u = new URL(url);
    return u.hostname + (u.pathname !== '/' ? u.pathname.slice(0, 30) + '...' : '');
  } catch {
    return url.slice(0, 50);
  }
}

function getHostname(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

function formatTimestamp(ts) {
  const d = new Date(ts);
  return d.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function el(id) { return document.getElementById(id); }

// ===== Score Ring Animation =====

function updateScoreRing(score, level) {
  const fill = el('score-ring-fill');
  const circumference = 2 * Math.PI * 32; // r=32
  const offset = circumference - (score / 100) * circumference;
  fill.style.strokeDashoffset = offset;
  fill.style.strokeDasharray = `${circumference} ${circumference}`;

  const card = el('overall-score-card');
  card.className = 'overall-score-card score-' + level;

  el('overall-score-text').textContent = score;
  const labelInfo = getScoreLabel(score);
  el('overall-score-label').textContent = labelInfo.label;
}

function getBadgeClass(score) {
  if (score >= 80) return 'danger';
  if (score >= 60) return 'warning';
  if (score >= 40) return 'caution';
  if (score >= 20) return 'ok';
  return 'safe';
}

// ===== Initialize Popup =====

async function init() {
  // Get current tab
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  currentTab = tab;

  if (!tab?.url || tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://')) {
    el('current-url').textContent = '不支持此页面 / Page not supported';
    el('btn-scan').disabled = true;
    return;
  }

  // Display URL
  el('current-url').textContent = formatUrl(tab.url);
  el('current-url').title = tab.url;

  // Check whitelist/blacklist status
  await checkUrlStatus(tab.url);

  // Load saved scope preferences
  await loadScopePreferences();

  // Load history for current URL if available
  await loadUrlHistory(tab.url);
}

async function checkUrlStatus(url) {
  try {
    const response = await chrome.runtime.sendMessage({ type: 'CHECK_URL_LISTS', url });
    const status = response?.status || 'none';

    const dot = el('url-status-dot');
    const badge = el('list-badge');
    const alert = el('alert-banner');

    if (status === 'whitelist') {
      dot.style.background = '#22c55e';
      badge.textContent = '✅ 白名单';
      badge.className = 'list-badge whitelist';
      badge.style.display = 'block';
      alert.textContent = '此域名在白名单中，内容被视为可信 / Domain is whitelisted - content trusted';
      alert.className = 'alert-banner info';
      alert.style.display = 'block';
    } else if (status === 'blacklist') {
      dot.style.background = '#ef4444';
      badge.textContent = '⛔ 黑名单';
      badge.className = 'list-badge blacklist';
      badge.style.display = 'block';
      alert.textContent = '此域名在黑名单中，内容可能全部为AI生成 / Domain is blacklisted - content likely AI';
      alert.className = 'alert-banner warning';
      alert.style.display = 'block';
    } else {
      dot.style.background = '#3b82f6';
    }
  } catch (e) {
    console.error('Failed to check URL lists:', e);
  }
}

async function loadScopePreferences() {
  const stored = await chrome.storage.local.get('settings');
  const scope = stored.settings?.defaultScope;
  if (scope) {
    el('scope-text').checked = scope.text !== false;
    el('scope-images').checked = scope.images !== false;
    el('scope-videos').checked = scope.videos !== false;
  }
}

async function loadUrlHistory(url) {
  try {
    const response = await chrome.runtime.sendMessage({ type: 'GET_HISTORY', url });
    const history = response?.history || [];
    if (history.length > 0) {
      const latest = history[0];
      el('result-timestamp').textContent = formatTimestamp(latest.timestamp);
    }
  } catch (e) {}
}

// ===== Scan Logic =====

async function startScan() {
  if (!currentTab) return;

  const scope = {
    text: el('scope-text').checked,
    images: el('scope-images').checked,
    videos: el('scope-videos').checked
  };

  if (!scope.text && !scope.images && !scope.videos) {
    alert('请至少选择一种内容类型 / Please select at least one content type');
    return;
  }

  // Save scope preference
  const stored = await chrome.storage.local.get('settings');
  const settings = stored.settings || {};
  settings.defaultScope = scope;
  await chrome.storage.local.set({ settings });

  // UI: scanning state
  setScanningState(true);
  el('results-section').style.display = 'none';

  try {
    // Extract content from page
    let content;

    if (selectionModeActive && selectedText) {
      // Use selected text only
      content = {
        meta: { url: currentTab.url, title: currentTab.title, timestamp: Date.now() },
        text: scope.text ? selectedText : '',
        images: [],
        videos: []
      };
    } else {
      // Extract from full page
      const [response] = await chrome.scripting.executeScript({
        target: { tabId: currentTab.id },
        func: (scope) => {
          return new Promise(resolve => {
            chrome.runtime.sendMessage({ type: 'EXTRACT_CONTENT', scope }, resolve);
          });
        },
        args: [scope]
      });
      content = response?.result?.data;
    }

    if (!content) throw new Error('无法提取页面内容 / Could not extract page content');

    updateProgress(40);

    // Run detection via background
    const result = await chrome.runtime.sendMessage({
      type: 'RUN_SCAN',
      tabId: currentTab.id,
      url: currentTab.url,
      scope,
      content
    });

    updateProgress(100);

    if (result?.success) {
      scanResults = result.result;
      displayResults(result.result);
    } else {
      throw new Error(result?.error || '检测失败 / Detection failed');
    }
  } catch (e) {
    console.error('Scan failed:', e);
    showError(e.message);
  } finally {
    setScanningState(false);
  }
}

function setScanningState(scanning) {
  const btn = el('btn-scan');
  const progress = el('scan-progress');

  btn.disabled = scanning;

  if (scanning) {
    btn.className = 'scan-btn scanning';
    el('scan-btn-icon').textContent = '⏳';
    el('scan-btn-text').textContent = '正在检测... / Scanning...';
    progress.style.display = 'block';
    el('progress-fill').style.width = '10%';
  } else {
    btn.className = 'scan-btn';
    el('scan-btn-icon').textContent = '🔍';
    el('scan-btn-text').textContent = '开始检测 / Start Scan';
    progress.style.display = 'none';
  }
}

function updateProgress(pct) {
  el('progress-fill').style.width = pct + '%';
}

// ===== Display Results =====

function displayResults(result) {
  const section = el('results-section');
  section.style.display = 'block';
  el('history-section').style.display = 'none';
  showingHistory = false;

  el('result-timestamp').textContent = formatTimestamp(result.timestamp || Date.now());

  // Overall score
  const overallScore = result.overallScore || 0;
  const scoreInfo = getScoreLabel(overallScore);
  updateScoreRing(overallScore, scoreInfo.level);

  let sublabel = `检测方法 / Method: `;
  if (result.listStatus === 'whitelist') {
    sublabel += '白名单 / Whitelist';
    el('overall-score-sublabel').textContent = sublabel;
  } else if (result.listStatus === 'blacklist') {
    sublabel += '黑名单 / Blacklist';
    el('overall-score-sublabel').textContent = sublabel;
  } else {
    const methods = new Set();
    if (result.text?.method) methods.add(result.text.method);
    result.images?.forEach(i => { if (i.method) methods.add(i.method); });
    result.videos?.forEach(v => { if (v.method) methods.add(v.method); });
    el('overall-score-sublabel').textContent = sublabel + Array.from(methods).join(', ');
  }

  // Text results
  if (result.text) {
    const card = el('text-results');
    card.style.display = 'block';
    const score = result.text.score || 0;
    const badgeClass = getBadgeClass(score);
    el('text-score-badge').textContent = `${score}/100`;
    el('text-score-badge').className = `result-badge ${badgeClass}`;

    const details = el('text-result-details');
    if (result.text.reasons?.length > 0) {
      details.innerHTML = result.text.reasons.map(r =>
        `<div class="result-reason">${escapeHtml(r)}</div>`
      ).join('');
    } else {
      details.textContent = '未发现明显的AI生成特征 / No significant AI patterns detected';
    }
  } else {
    el('text-results').style.display = 'none';
  }

  // Image results
  if (result.images && result.images.length > 0) {
    const card = el('image-results');
    card.style.display = 'block';
    const maxScore = Math.max(...result.images.map(i => i.score || 0));
    const badgeClass = getBadgeClass(maxScore);
    el('image-score-badge').textContent = `${maxScore}/100 (${result.images.length}张)`;
    el('image-score-badge').className = `result-badge ${badgeClass}`;

    const details = el('image-result-details');
    const aiImages = result.images.filter(i => (i.score || 0) >= 40);
    if (aiImages.length > 0) {
      details.innerHTML = `检测到${aiImages.length}张可能是AI生成的图片 / Detected ${aiImages.length} potentially AI-generated image(s)`;
    } else {
      details.textContent = `已分析${result.images.length}张图片，未发现明显AI特征 / Analyzed ${result.images.length} images, no AI patterns found`;
    }

    // Show image list
    const list = el('image-list');
    list.innerHTML = result.images.slice(0, 8).map(img => {
      const sc = img.score || 0;
      const bc = getBadgeClass(sc);
      let imgFilename = '[No filename]';
      try {
        imgFilename = new URL(img.src).pathname.split('/').pop() || img.src;
      } catch (_) {
        imgFilename = img.src ? img.src.slice(0, 40) : '[Invalid URL]';
      }
      return `
        <div class="image-item">
          <img src="${escapeHtml(img.src)}" onerror="this.style.display='none'" alt="">
          <div class="image-item-info">
            <div class="image-item-url">${escapeHtml(imgFilename)}</div>
            <span class="result-badge ${bc}" style="font-size:10px">${sc}/100</span>
          </div>
        </div>
      `;
    }).join('');
  } else {
    el('image-results').style.display = 'none';
  }

  // Video results
  if (result.videos && result.videos.length > 0) {
    const card = el('video-results');
    card.style.display = 'block';
    const maxScore = Math.max(...result.videos.map(v => v.score || 0));
    const badgeClass = getBadgeClass(maxScore);
    el('video-score-badge').textContent = `${maxScore}/100 (${result.videos.length}个)`;
    el('video-score-badge').className = `result-badge ${badgeClass}`;

    const details = el('video-result-details');
    const aiVideos = result.videos.filter(v => (v.score || 0) >= 40);
    if (aiVideos.length > 0) {
      details.innerHTML = `检测到${aiVideos.length}个可能是AI生成的视频 / Detected ${aiVideos.length} potentially AI-generated video(s)`;
    } else {
      details.textContent = `已分析${result.videos.length}个视频，未发现明显AI特征 / Analyzed ${result.videos.length} videos, no AI patterns found`;
    }
  } else {
    el('video-results').style.display = 'none';
  }
}

function showError(message) {
  const section = el('results-section');
  section.style.display = 'block';
  section.innerHTML = `
    <div style="padding: 16px; text-align: center; color: #dc2626;">
      <div style="font-size: 24px; margin-bottom: 8px;">⚠️</div>
      <div style="font-weight: 600; margin-bottom: 4px;">检测失败 / Scan Failed</div>
      <div style="font-size: 11px; color: #94a3b8;">${escapeHtml(message)}</div>
    </div>
  `;
}

function escapeHtml(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ===== Selection Mode =====

async function toggleSelectionMode() {
  if (selectionModeActive) {
    // Disable selection mode
    await chrome.scripting.executeScript({
      target: { tabId: currentTab.id },
      func: () => chrome.runtime.sendMessage({ type: 'DISABLE_SELECTION_MODE' })
    });
    deactivateSelectionUI();
  } else {
    // Enable selection mode
    await chrome.scripting.executeScript({
      target: { tabId: currentTab.id },
      func: () => chrome.runtime.sendMessage({ type: 'ENABLE_SELECTION_MODE' })
    });
    activateSelectionUI();
    // Close popup so user can select on page
    window.close();
  }
}

function activateSelectionUI() {
  selectionModeActive = true;
  el('selection-indicator').style.display = 'flex';
  el('btn-select-mode').textContent = '🔴 取消选择';
}

function deactivateSelectionUI() {
  selectionModeActive = false;
  selectedText = '';
  el('selection-indicator').style.display = 'none';
  el('selected-preview').style.display = 'none';
  el('btn-select-mode').textContent = '🖱️ 选择范围';
}

// ===== History =====

async function toggleHistory() {
  showingHistory = !showingHistory;
  if (showingHistory) {
    el('results-section').style.display = 'none';
    el('history-section').style.display = 'block';
    await loadHistory();
  } else {
    el('history-section').style.display = 'none';
    if (scanResults) el('results-section').style.display = 'block';
  }
}

async function loadHistory() {
  const response = await chrome.runtime.sendMessage({ type: 'GET_HISTORY' });
  const history = response?.history || [];
  const list = el('history-list');

  if (history.length === 0) {
    list.innerHTML = '<div class="empty-state">暂无检测记录 / No scan history yet</div>';
    return;
  }

  list.innerHTML = history.slice(0, 50).map(item => {
    const score = item.score || 0;
    const bc = getBadgeClass(score);
    const dotColors = { danger: '#ef4444', warning: '#f59e0b', caution: '#f97316', ok: '#22c55e', safe: '#10b981' };
    const dotColor = dotColors[bc] || '#94a3b8';
    const typeIcon = { text: '📝', image: '🖼️', images: '🖼️', video: '🎬', videos: '🎬', full: '📄' }[item.contentType] || '📄';

    return `
      <div class="history-item">
        <div class="history-score-dot" style="background: ${dotColor}20; color: ${dotColor}">
          ${score}
        </div>
        <div class="history-info">
          <div class="history-url" title="${escapeHtml(item.url)}">${typeIcon} ${escapeHtml(formatUrl(item.url))}</div>
          <div class="history-meta">${formatTimestamp(item.timestamp)} · ${item.method || 'heuristic'} · ${item.contentType}</div>
        </div>
      </div>
    `;
  }).join('');
}

// ===== Whitelist / Blacklist =====

async function addToList(listName) {
  if (!currentTab?.url) return;
  const hostname = getHostname(currentTab.url);
  const note = currentTab.title || '';

  const result = await chrome.runtime.sendMessage({
    type: 'ADD_TO_LIST',
    list: listName,
    pattern: hostname,
    note
  });

  if (result?.success) {
    const label = listName === 'whitelist' ? '白名单 / whitelist' : '黑名单 / blacklist';
    if (result.exists) {
      alert(`"${hostname}" 已在${label}中 / "${hostname}" is already in ${listName}`);
    } else {
      alert(`已将 "${hostname}" 加入${label} / Added "${hostname}" to ${listName}`);
      await checkUrlStatus(currentTab.url);
    }
  }
}

// ===== Event Listeners =====

document.addEventListener('DOMContentLoaded', async () => {
  await init();

  el('btn-scan').addEventListener('click', startScan);

  el('btn-select-mode').addEventListener('click', async () => {
    if (!currentTab) return;
    // Enable selection mode in content script, then close popup
    await chrome.scripting.executeScript({
      target: { tabId: currentTab.id },
      func: () => chrome.runtime.sendMessage({ type: 'ENABLE_SELECTION_MODE' })
    });
    window.close();
  });

  el('btn-cancel-selection').addEventListener('click', async () => {
    await chrome.scripting.executeScript({
      target: { tabId: currentTab.id },
      func: () => chrome.runtime.sendMessage({ type: 'DISABLE_SELECTION_MODE' })
    });
    deactivateSelectionUI();
  });

  el('btn-clear-selection').addEventListener('click', () => {
    selectedText = '';
    el('selected-preview').style.display = 'none';
  });

  el('btn-options').addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });

  el('link-options').addEventListener('click', (e) => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
  });

  el('btn-history').addEventListener('click', toggleHistory);

  el('btn-clear-history').addEventListener('click', async () => {
    if (confirm('确认清除所有检测记录？/ Clear all scan history?')) {
      await chrome.runtime.sendMessage({ type: 'CLEAR_HISTORY' });
      await loadHistory();
    }
  });

  el('btn-add-whitelist').addEventListener('click', () => addToList('whitelist'));
  el('btn-add-blacklist').addEventListener('click', () => addToList('blacklist'));
});

// Listen for messages from content script (via background)
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'TEXT_SELECTED') {
    selectedText = message.text;
    el('selected-preview').style.display = 'flex';
    el('selected-char-count').textContent = `${message.length} 字符`;
  } else if (message.type === 'SELECTION_CANCELLED') {
    deactivateSelectionUI();
  }
});
