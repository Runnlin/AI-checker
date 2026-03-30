/**
 * Content Script - Extracts page content for AI detection
 * Injected into all web pages
 */

'use strict';

// State for selection mode
let selectionMode = false;
let selectionOverlay = null;
let highlightBox = null;
let hoveredElement = null;
let selectedElement = null;

/**
 * Extract all visible text content from the page.
 * Respects the given CSS selector scope if provided.
 * If an element was picked via element picker, extracts text from that element.
 */
function extractText(scopeSelector) {
  let root;
  if (scopeSelector) {
    root = document.querySelector(scopeSelector) || document.body;
  } else if (selectedElement) {
    root = selectedElement;
  } else {
    root = document.body;
  }

  // Cache computed styles per parent element to avoid redundant style computations
  const styleCache = new WeakMap();

  const walker = document.createTreeWalker(
    root,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode(node) {
        const parent = node.parentElement;
        if (!parent) return NodeFilter.FILTER_REJECT;
        const tag = parent.tagName.toLowerCase();
        if (['script', 'style', 'noscript', 'meta', 'head'].includes(tag)) {
          return NodeFilter.FILTER_REJECT;
        }
        if (!styleCache.has(parent)) {
          const style = window.getComputedStyle(parent);
          styleCache.set(parent, {
            hidden: style.display === 'none' || style.visibility === 'hidden'
          });
        }
        if (styleCache.get(parent).hidden) {
          return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      }
    }
  );

  const texts = [];
  let node;
  while ((node = walker.nextNode())) {
    const text = node.nodeValue.trim();
    if (text.length > 0) texts.push(text);
  }

  return texts.join(' ');
}

/**
 * Extract all images from the page.
 */
function extractImages(scopeSelector) {
  let root = scopeSelector ? (document.querySelector(scopeSelector) || document.body) : document.body;
  const imgs = Array.from(root.querySelectorAll('img'));

  return imgs
    .filter(img => {
      // Filter out tiny images (likely icons/tracking pixels)
      const naturalW = img.naturalWidth || img.width || 0;
      const naturalH = img.naturalHeight || img.height || 0;
      return naturalW > 50 && naturalH > 50 && img.src;
    })
    .map(img => ({
      src: img.src,
      alt: img.alt || '',
      width: img.naturalWidth || img.width,
      height: img.naturalHeight || img.height,
      loading: img.loading,
      id: img.id || ''
    }));
}

/**
 * Extract all videos from the page.
 */
function extractVideos(scopeSelector) {
  let root = scopeSelector ? (document.querySelector(scopeSelector) || document.body) : document.body;

  const results = [];

  // HTML5 video elements
  const videos = Array.from(root.querySelectorAll('video'));
  videos.forEach(video => {
    const src = video.src || (video.querySelector('source')?.src) || '';
    results.push({
      type: 'video',
      src,
      poster: video.poster || '',
      title: video.title || video.getAttribute('aria-label') || '',
      width: video.videoWidth || video.width || 0,
      height: video.videoHeight || video.height || 0
    });
  });

  // Embedded iframes (YouTube, Vimeo, etc.)
  const iframes = Array.from(root.querySelectorAll('iframe'));
  iframes.forEach(iframe => {
    const src = iframe.src || '';
    const isVideo = /youtube|vimeo|dailymotion|bilibili|youku|ixigua|twitch|rumble/i.test(src);
    if (isVideo) {
      results.push({
        type: 'iframe',
        src,
        title: iframe.title || '',
        width: iframe.width || 0,
        height: iframe.height || 0
      });
    }
  });

  return results;
}

/**
 * Get page metadata.
 */
function getPageMeta() {
  return {
    title: document.title,
    url: window.location.href,
    description: document.querySelector('meta[name="description"]')?.content || '',
    author: document.querySelector('meta[name="author"]')?.content || '',
    generator: document.querySelector('meta[name="generator"]')?.content || '',
    timestamp: Date.now()
  };
}

/**
 * Enable element-picker selection mode (ad-blocker style).
 * Hovering highlights the element under the cursor; clicking selects it.
 */
function enableSelectionMode() {
  if (selectionMode) return;
  selectionMode = true;
  selectedElement = null;

  // Create floating highlight box that tracks the hovered element
  highlightBox = document.createElement('div');
  highlightBox.id = 'ai-checker-highlight-box';
  highlightBox.style.cssText = [
    'position:fixed',
    'pointer-events:none',
    'z-index:2147483646',
    'border:2px solid #3b82f6',
    'background:rgba(59,130,246,0.12)',
    'border-radius:3px',
    'display:none',
    'box-sizing:border-box',
    'transition:top 0.05s,left 0.05s,width 0.05s,height 0.05s'
  ].join(';');
  document.documentElement.appendChild(highlightBox);

  // Create overlay banner
  selectionOverlay = document.createElement('div');
  selectionOverlay.id = 'ai-checker-selection-overlay';
  selectionOverlay.style.cssText = [
    'position:fixed',
    'top:0',
    'left:0',
    'right:0',
    'z-index:2147483647',
    'background:rgba(59,130,246,0.95)',
    'color:white',
    'padding:10px 16px',
    'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif',
    'font-size:14px',
    'display:flex',
    'align-items:center',
    'justify-content:space-between',
    'box-shadow:0 2px 8px rgba(0,0,0,0.3)'
  ].join(';');
  selectionOverlay.innerHTML = `
    <span>🔍 点击选择要检测的元素 / Click an element to select it for analysis</span>
    <button id="ai-checker-cancel-selection" style="
      background:rgba(255,255,255,0.2);
      border:1px solid rgba(255,255,255,0.5);
      color:white;
      padding:4px 12px;
      border-radius:4px;
      cursor:pointer;
      font-size:13px;
    ">取消 / Cancel</button>
  `;
  document.documentElement.appendChild(selectionOverlay);

  document.getElementById('ai-checker-cancel-selection')
    .addEventListener('click', () => disableSelectionMode(true));

  document.addEventListener('mousemove', onMouseMove, true);
  document.addEventListener('click', onElementClick, true);
  document.addEventListener('keydown', onKeyDown, true);
}

/**
 * Disable selection mode and clean up overlays.
 * @param {boolean} cancelled - true if user cancelled (no element selected)
 */
function disableSelectionMode(cancelled) {
  selectionMode = false;

  if (selectionOverlay) {
    selectionOverlay.remove();
    selectionOverlay = null;
  }
  if (highlightBox) {
    highlightBox.remove();
    highlightBox = null;
  }
  hoveredElement = null;

  document.removeEventListener('mousemove', onMouseMove, true);
  document.removeEventListener('click', onElementClick, true);
  document.removeEventListener('keydown', onKeyDown, true);

  if (cancelled) {
    selectedElement = null;
    chrome.storage.local.remove('selectedElement');
    chrome.runtime.sendMessage({ type: 'SELECTION_CANCELLED' });
  }
}

/**
 * Highlight the element under the cursor as the mouse moves.
 */
function onMouseMove(e) {
  if (!highlightBox) return;
  const target = e.target;
  // Skip the overlay elements themselves
  if (selectionOverlay && selectionOverlay.contains(target)) return;
  if (target === highlightBox) return;

  hoveredElement = target;
  const rect = target.getBoundingClientRect();
  highlightBox.style.display = 'block';
  highlightBox.style.left = rect.left + 'px';
  highlightBox.style.top = rect.top + 'px';
  highlightBox.style.width = rect.width + 'px';
  highlightBox.style.height = rect.height + 'px';
}

/**
 * Select the hovered element when the user clicks.
 */
function onElementClick(e) {
  if (!selectionMode) return;
  // Ignore clicks on the banner itself
  if (selectionOverlay && selectionOverlay.contains(e.target)) return;

  e.preventDefault();
  e.stopPropagation();

  const element = hoveredElement || e.target;
  const text = (element.innerText || element.textContent || '').trim();
  selectedElement = element;

  // Persist selected text so the popup can read it after reopening
  chrome.storage.local.set({ selectedElement: { text, timestamp: Date.now() } });

  // Notify background (popup may be closed; it will read from storage on reopen)
  chrome.runtime.sendMessage({ type: 'TEXT_SELECTED', text, length: text.length });

  disableSelectionMode(false);

  // Show in-page dialog for immediate detection
  showDetectionDialog(text);
}

/**
 * Allow Escape key to cancel selection mode.
 */
function onKeyDown(e) {
  if (e.key === 'Escape') {
    disableSelectionMode(true);
  }
}

/**
 * Show an in-page detection dialog after element selection.
 * Lets user start detection and displays results without reopening the popup.
 */
function showDetectionDialog(text) {
  // Remove any existing dialog
  const existing = document.getElementById('ai-checker-detection-dialog');
  if (existing) existing.remove();

  const previewText = text.length > 200 ? text.slice(0, 200) + '…' : text;
  const charCount = text.length;

  const dialog = document.createElement('div');
  dialog.id = 'ai-checker-detection-dialog';
  dialog.style.cssText = [
    'position:fixed',
    'bottom:24px',
    'right:24px',
    'z-index:2147483647',
    'width:320px',
    'background:#fff',
    'border-radius:12px',
    'box-shadow:0 8px 32px rgba(0,0,0,0.18),0 2px 8px rgba(0,0,0,0.1)',
    'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif',
    'font-size:13px',
    'color:#1a1a2e',
    'overflow:hidden',
  ].join(';');

  dialog.innerHTML = `
    <div id="ai-checker-dialog-header" style="
      background:linear-gradient(135deg,#1e40af,#3b82f6);
      color:white;
      padding:10px 14px;
      display:flex;
      align-items:center;
      justify-content:space-between;
    ">
      <span style="font-weight:700;font-size:13px;">🤖 AI Content Checker</span>
      <button id="ai-checker-dialog-close" style="
        background:rgba(255,255,255,0.2);
        border:1px solid rgba(255,255,255,0.4);
        color:white;
        border-radius:4px;
        padding:2px 8px;
        cursor:pointer;
        font-size:12px;
      ">✕</button>
    </div>
    <div style="padding:12px 14px;">
      <div style="font-size:11px;color:#475569;margin-bottom:6px;">
        已选择 / Selected: <strong style="color:#1e40af;">${charCount} 字符</strong>
      </div>
      <div id="ai-checker-text-preview" style="
        font-size:11px;
        color:#64748b;
        background:#f8fafc;
        border:1px solid #e2e8f0;
        border-radius:6px;
        padding:8px;
        max-height:80px;
        overflow-y:auto;
        line-height:1.5;
        margin-bottom:10px;
        overflow-wrap:break-word;
        word-break:break-word;
      ">${escapeDialogHtml(previewText)}</div>
      <button id="ai-checker-start-detect" style="
        width:100%;
        padding:9px 0;
        background:linear-gradient(135deg,#1e40af,#3b82f6);
        color:white;
        border:none;
        border-radius:7px;
        font-size:13px;
        font-weight:600;
        cursor:pointer;
        display:flex;
        align-items:center;
        justify-content:center;
        gap:6px;
      ">
        <span id="ai-checker-detect-icon">🔍</span>
        <span id="ai-checker-detect-label">开始检测 / Start Detection</span>
      </button>
    </div>
    <div id="ai-checker-dialog-result" style="display:none;padding:0 14px 12px;"></div>
  `;

  document.documentElement.appendChild(dialog);

  // Close button
  document.getElementById('ai-checker-dialog-close').addEventListener('click', () => {
    dialog.remove();
  });

  // Start detection button
  document.getElementById('ai-checker-start-detect').addEventListener('click', async () => {
    const btn = document.getElementById('ai-checker-start-detect');
    const icon = document.getElementById('ai-checker-detect-icon');
    const label = document.getElementById('ai-checker-detect-label');

    // Show loading state
    btn.disabled = true;
    btn.style.background = 'linear-gradient(135deg,#6366f1,#8b5cf6)';
    icon.textContent = '⏳';
    label.textContent = '正在检测... / Scanning...';

    try {
      if (!chrome.runtime?.id) {
        renderDialogError('扩展已更新，请刷新页面后重试 / Extension updated, please refresh the page');
        return;
      }
      const response = await chrome.runtime.sendMessage({
        type: 'RUN_TEXT_SCAN',
        text,
        url: window.location.href
      });

      if (response && response.success && response.result) {
        renderDialogResult(response.result);
      } else {
        renderDialogError('检测失败 / Detection failed');
      }
    } catch (err) {
      renderDialogError(err.message || '检测出错 / Detection error');
    } finally {
      btn.disabled = false;
      btn.style.background = 'linear-gradient(135deg,#1e40af,#3b82f6)';
      icon.textContent = '🔍';
      label.textContent = '重新检测 / Re-scan';
    }
  });
}

/**
 * Render detection result inside the in-page dialog.
 */
function renderDialogResult(result) {
  const score = result.score || 0;
  const reasons = result.reasons || [];

  // Determine color and label based on score
  let color, bgColor, label;
  if (score >= 80) {
    color = '#dc2626'; bgColor = '#fee2e2'; label = '极可能是AI生成 / Very likely AI';
  } else if (score >= 60) {
    color = '#d97706'; bgColor = '#fef3c7'; label = '可能是AI生成 / Likely AI';
  } else if (score >= 40) {
    color = '#ea580c'; bgColor = '#ffedd5'; label = '部分可能是AI生成 / Possibly AI';
  } else if (score >= 20) {
    color = '#16a34a'; bgColor = '#dcfce7'; label = '可能不是AI生成 / Unlikely AI';
  } else {
    color = '#059669'; bgColor = '#d1fae5'; label = '很可能不是AI生成 / Very unlikely AI';
  }

  const reasonsHtml = reasons.length > 0
    ? reasons.map(r => `<div style="display:flex;gap:4px;margin-bottom:2px;"><span style="color:#94a3b8;flex-shrink:0;">•</span><span>${escapeDialogHtml(r)}</span></div>`).join('')
    : '<div style="color:#94a3b8;">未发现明显AI特征 / No significant AI patterns</div>';

  const resultEl = document.getElementById('ai-checker-dialog-result');
  resultEl.style.display = 'block';
  resultEl.innerHTML = `
    <div style="border-top:1px solid #e2e8f0;padding-top:10px;">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;">
        <div style="
          width:48px;height:48px;
          border-radius:50%;
          background:${bgColor};
          color:${color};
          display:flex;align-items:center;justify-content:center;
          font-size:16px;font-weight:700;
          flex-shrink:0;
        ">${score}</div>
        <div>
          <div style="font-weight:600;color:${color};font-size:12px;">${label}</div>
          <div style="font-size:10px;color:#94a3b8;margin-top:2px;">
            检测方法 / Method: ${escapeDialogHtml(result.method || 'heuristic')}
          </div>
        </div>
      </div>
      <div style="font-size:11px;color:#475569;line-height:1.6;">
        ${reasonsHtml}
      </div>
    </div>
  `;
}

/**
 * Render an error message inside the in-page dialog.
 */
function renderDialogError(message) {
  const resultEl = document.getElementById('ai-checker-dialog-result');
  resultEl.style.display = 'block';
  resultEl.innerHTML = `
    <div style="border-top:1px solid #e2e8f0;padding-top:10px;text-align:center;color:#dc2626;">
      <div style="font-size:20px;margin-bottom:4px;">⚠️</div>
      <div style="font-size:11px;">${escapeDialogHtml(message)}</div>
    </div>
  `;
}

/**
 * Escape HTML for safe insertion into dialog innerHTML.
 */
function escapeDialogHtml(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// Listen for messages from popup/background
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.type) {
    case 'EXTRACT_CONTENT': {
      const scope = message.scope || {};
      const selector = message.scopeSelector || null;
      const result = {
        meta: getPageMeta(),
        text: scope.text ? extractText(selector) : '',
        images: scope.images ? extractImages(selector) : [],
        videos: scope.videos ? extractVideos(selector) : []
      };
      sendResponse({ success: true, data: result });
      break;
    }

    case 'ENABLE_SELECTION_MODE':
      enableSelectionMode();
      sendResponse({ success: true });
      break;

    case 'DISABLE_SELECTION_MODE':
      disableSelectionMode(true);
      sendResponse({ success: true });
      break;

    case 'GET_SELECTED_TEXT': {
      const text = selectedElement
        ? (selectedElement.innerText || selectedElement.textContent || '').trim()
        : '';
      sendResponse({ success: true, text });
      break;
    }

    case 'EXTRACT_SELECTED_TEXT': {
      const text = selectedElement
        ? (selectedElement.innerText || selectedElement.textContent || '').trim()
        : '';
      sendResponse({ success: true, text });
      break;
    }

    case 'PING':
      sendResponse({ success: true, ready: true });
      break;

    default:
      sendResponse({ success: false, error: 'Unknown message type' });
  }
  return true; // Keep message channel open for async response
});
