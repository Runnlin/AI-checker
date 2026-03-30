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
}

/**
 * Allow Escape key to cancel selection mode.
 */
function onKeyDown(e) {
  if (e.key === 'Escape') {
    disableSelectionMode(true);
  }
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
