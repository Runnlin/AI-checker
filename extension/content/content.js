/**
 * Content Script - Extracts page content for AI detection
 * Injected into all web pages
 */

'use strict';

// State for selection mode
let selectionMode = false;
let selectionOverlay = null;
let selectionHighlight = null;
let selectedRange = null;

/**
 * Extract all visible text content from the page.
 * Respects the given CSS selector scope if provided.
 */
function extractText(scopeSelector) {
  let root;
  if (scopeSelector) {
    root = document.querySelector(scopeSelector) || document.body;
  } else if (selectedRange) {
    return selectedRange.toString();
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
 * Enable text selection mode with visual overlay.
 */
function enableSelectionMode() {
  if (selectionMode) return;
  selectionMode = true;

  // Create overlay banner
  selectionOverlay = document.createElement('div');
  selectionOverlay.id = 'ai-checker-selection-overlay';
  selectionOverlay.innerHTML = `
    <div style="
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      z-index: 2147483647;
      background: rgba(59, 130, 246, 0.95);
      color: white;
      padding: 10px 16px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      font-size: 14px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      box-shadow: 0 2px 8px rgba(0,0,0,0.3);
    ">
      <span>🔍 选择模式已激活 - 请选择要检测的文本区域 / Selection Mode Active - Select text to analyze</span>
      <button id="ai-checker-cancel-selection" style="
        background: rgba(255,255,255,0.2);
        border: 1px solid rgba(255,255,255,0.5);
        color: white;
        padding: 4px 12px;
        border-radius: 4px;
        cursor: pointer;
        font-size: 13px;
      ">取消 / Cancel</button>
    </div>
  `;
  document.body.appendChild(selectionOverlay);

  document.getElementById('ai-checker-cancel-selection').addEventListener('click', disableSelectionMode);

  // Listen for selection changes
  document.addEventListener('mouseup', onMouseUp);
}

/**
 * Disable selection mode.
 */
function disableSelectionMode() {
  selectionMode = false;
  selectedRange = null;
  if (selectionOverlay) {
    selectionOverlay.remove();
    selectionOverlay = null;
  }
  if (selectionHighlight) {
    selectionHighlight.remove();
    selectionHighlight = null;
  }
  document.removeEventListener('mouseup', onMouseUp);
  chrome.runtime.sendMessage({ type: 'SELECTION_CANCELLED' });
}

/**
 * Handle mouse up in selection mode.
 */
function onMouseUp() {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return;

  const text = selection.toString().trim();
  if (text.length < 10) return;

  selectedRange = selection.getRangeAt(0);

  // Notify popup that selection was made
  chrome.runtime.sendMessage({
    type: 'TEXT_SELECTED',
    text: text,
    length: text.length
  });
}

/**
 * Get the currently selected text.
 */
function getSelectedText() {
  if (selectedRange) {
    return selectedRange.toString();
  }
  return window.getSelection()?.toString() || '';
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
      disableSelectionMode();
      sendResponse({ success: true });
      break;

    case 'GET_SELECTED_TEXT': {
      const text = getSelectedText();
      sendResponse({ success: true, text });
      break;
    }

    case 'EXTRACT_SELECTED_TEXT': {
      const text = selectedRange ? selectedRange.toString() : window.getSelection()?.toString() || '';
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
