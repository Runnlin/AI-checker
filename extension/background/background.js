/**
 * Background Service Worker
 * Handles AI detection, whitelist/blacklist, and URL history management
 */

'use strict';

importScripts('../utils/ai-detector.js');

// Initialize default settings on install
chrome.runtime.onInstalled.addListener(async () => {
  const existing = await chrome.storage.local.get(['settings', 'whitelist', 'blacklist', 'history']);

  if (!existing.settings) {
    await chrome.storage.local.set({
      settings: {
        defaultScope: { text: true, images: true, videos: true },
        apiKeys: { gptzero: '', originality: '', hive: '' },
        autoScanEnabled: false,
        language: 'zh'
      }
    });
  }

  if (!existing.whitelist) {
    await chrome.storage.local.set({ whitelist: [] });
  }

  if (!existing.blacklist) {
    await chrome.storage.local.set({ blacklist: [] });
  }

  if (!existing.history) {
    await chrome.storage.local.set({ history: [] });
  }

  // Set up context menu
  chrome.contextMenus.create({
    id: 'ai-checker-scan-page',
    title: '🔍 AI检测器: 扫描此页面 / Scan this page',
    contexts: ['page']
  });

  chrome.contextMenus.create({
    id: 'ai-checker-scan-selection',
    title: '🔍 AI检测器: 检测选中文本 / Check selected text',
    contexts: ['selection']
  });

  chrome.contextMenus.create({
    id: 'ai-checker-scan-image',
    title: '🔍 AI检测器: 检测此图片 / Check this image',
    contexts: ['image']
  });
});

// Handle context menu clicks
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!tab?.id) return;

  switch (info.menuItemId) {
    case 'ai-checker-scan-page':
      await triggerFullPageScan(tab);
      break;

    case 'ai-checker-scan-selection':
      if (info.selectionText) {
        const result = await runTextDetection(info.selectionText, tab.url);
        await saveToHistory(tab.url, 'text', result);
        // Show result notification
        await showNotification('文本检测结果 / Text Detection Result', formatResultNotification(result));
      }
      break;

    case 'ai-checker-scan-image':
      if (info.srcUrl) {
        const result = await runImageDetection({ src: info.srcUrl, alt: '', width: 0, height: 0 });
        await saveToHistory(tab.url, 'image', result, info.srcUrl);
        await showNotification('图片检测结果 / Image Detection Result', formatResultNotification(result));
      }
      break;
  }
});

/**
 * Trigger a full page scan for a tab.
 */
async function triggerFullPageScan(tab) {
  try {
    const { settings } = await chrome.storage.local.get('settings');
    const scope = settings?.defaultScope || { text: true, images: true, videos: true };

    const [contentResult] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        return new Promise(resolve => {
          chrome.runtime.sendMessage({ type: 'EXTRACT_CONTENT', scope: { text: true, images: true, videos: true } }, resolve);
        });
      }
    });
  } catch (e) {
    console.error('Full page scan failed:', e);
  }
}

/**
 * Run AI detection on text content.
 */
async function runTextDetection(text, url) {
  const { settings } = await chrome.storage.local.get('settings');
  const apiKeys = settings?.apiKeys || {};

  try {
    const result = await detectTextAI(text, apiKeys);
    return { type: 'text', url, ...result, timestamp: Date.now() };
  } catch (e) {
    const heuristic = analyzeTextHeuristics(text);
    return { type: 'text', url, method: 'heuristic', ...heuristic, timestamp: Date.now() };
  }
}

/**
 * Run AI detection on image content.
 */
async function runImageDetection(imageData) {
  const { settings } = await chrome.storage.local.get('settings');
  const apiKeys = settings?.apiKeys || {};

  try {
    const result = await detectImageAI(imageData, apiKeys);
    return { type: 'image', ...result, timestamp: Date.now() };
  } catch (e) {
    const heuristic = analyzeImageHeuristics(imageData);
    return { type: 'image', method: 'heuristic', ...heuristic, timestamp: Date.now() };
  }
}

/**
 * Run AI detection on video content.
 */
async function runVideoDetection(videoData) {
  try {
    const result = await detectVideoAI(videoData);
    return { type: 'video', ...result, timestamp: Date.now() };
  } catch (e) {
    const heuristic = analyzeVideoHeuristics(videoData);
    return { type: 'video', method: 'heuristic', ...heuristic, timestamp: Date.now() };
  }
}

/**
 * Check if a URL matches the whitelist or blacklist.
 * Returns: 'whitelist', 'blacklist', or 'none'
 */
async function checkUrlLists(url) {
  const { whitelist = [], blacklist = [] } = await chrome.storage.local.get(['whitelist', 'blacklist']);

  const urlObj = new URL(url);
  const hostname = urlObj.hostname.replace(/^www\./, '');

  const matchPattern = (list) => list.some(entry => {
    if (!entry || !entry.pattern) return false;
    const pattern = entry.pattern.replace(/^www\./, '');
    // Support wildcard matching
    if (pattern.startsWith('*')) {
      return hostname.endsWith(pattern.slice(1));
    }
    // Domain or full URL match
    return hostname === pattern || url.includes(pattern);
  });

  if (matchPattern(whitelist)) return 'whitelist';
  if (matchPattern(blacklist)) return 'blacklist';
  return 'none';
}

/**
 * Save scan result to history.
 */
async function saveToHistory(url, contentType, result, contentRef) {
  const { history = [] } = await chrome.storage.local.get('history');

  const entry = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2),
    url,
    contentType,
    contentRef: contentRef || url,
    score: result.score || 0,
    method: result.method || 'heuristic',
    reasons: result.reasons || [],
    confidence: result.confidence || 'low',
    timestamp: Date.now()
  };

  // Keep only the latest N entries based on user's maxHistory setting
  const { settings } = await chrome.storage.local.get('settings');
  const maxHistory = settings?.maxHistory || 500;
  const updated = [entry, ...history].slice(0, maxHistory);
  await chrome.storage.local.set({ history: updated });
  return entry;
}

/**
 * Format a result for display in a notification.
 */
function formatResultNotification(result) {
  const label = getScoreLabel(result.score || 0);
  return `${label.label}\n分数 / Score: ${result.score || 0}/100\n检测方法 / Method: ${result.method || 'heuristic'}`;
}

/**
 * Show a Chrome notification.
 */
async function showNotification(title, message) {
  // Use badge text as a minimal notification (notifications API requires additional permission)
  console.log(`[AI Checker] ${title}: ${message}`);
}

/**
 * Process a full scan request from the popup.
 */
async function processScanRequest(tabId, tabUrl, scope, content) {
  const results = {
    url: tabUrl,
    timestamp: Date.now(),
    listStatus: await checkUrlLists(tabUrl),
    text: null,
    images: [],
    videos: [],
    overallScore: 0
  };

  // If blacklisted, mark all as AI without scanning
  if (results.listStatus === 'blacklist') {
    results.text = { score: 100, reasons: ['域名在黑名单中 / Domain is blacklisted'], confidence: 'high', method: 'blacklist' };
    results.overallScore = 100;
    await saveToHistory(tabUrl, 'full', { score: 100, method: 'blacklist', reasons: results.text.reasons });
    return results;
  }

  // If whitelisted, skip scanning
  if (results.listStatus === 'whitelist') {
    results.text = { score: 0, reasons: ['域名在白名单中 / Domain is whitelisted'], confidence: 'high', method: 'whitelist' };
    results.overallScore = 0;
    await saveToHistory(tabUrl, 'full', { score: 0, method: 'whitelist', reasons: results.text.reasons });
    return results;
  }

  const scores = [];

  // Text detection
  if (scope.text && content.text && content.text.length >= 50) {
    results.text = await runTextDetection(content.text, tabUrl);
    scores.push(results.text.score || 0);
    await saveToHistory(tabUrl, 'text', results.text);
  }

  // Image detection
  if (scope.images && content.images?.length > 0) {
    for (const img of content.images.slice(0, 20)) { // Limit to 20 images
      const imgResult = await runImageDetection(img);
      results.images.push({ ...imgResult, src: img.src });
      scores.push(imgResult.score || 0);
    }
    if (results.images.length > 0) {
      await saveToHistory(tabUrl, 'images', {
        score: Math.max(...results.images.map(i => i.score || 0)),
        method: 'heuristic',
        reasons: [`检测了${results.images.length}张图片 / Analyzed ${results.images.length} images`]
      });
    }
  }

  // Video detection
  if (scope.videos && content.videos?.length > 0) {
    for (const video of content.videos.slice(0, 10)) {
      const videoResult = await runVideoDetection(video);
      results.videos.push({ ...videoResult, src: video.src });
      scores.push(videoResult.score || 0);
    }
    if (results.videos.length > 0) {
      await saveToHistory(tabUrl, 'videos', {
        score: Math.max(...results.videos.map(v => v.score || 0)),
        method: 'heuristic',
        reasons: [`检测了${results.videos.length}个视频 / Analyzed ${results.videos.length} videos`]
      });
    }
  }

  // Calculate overall score (weighted average, text is most important)
  if (scores.length > 0) {
    results.overallScore = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
  }

  return results;
}

// Handle messages from popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    try {
      switch (message.type) {
        case 'CHECK_URL_LISTS': {
          const status = await checkUrlLists(message.url);
          sendResponse({ success: true, status });
          break;
        }

        case 'RUN_SCAN': {
          const result = await processScanRequest(
            message.tabId,
            message.url,
            message.scope,
            message.content
          );
          sendResponse({ success: true, result });
          break;
        }

        case 'GET_HISTORY': {
          const { history = [] } = await chrome.storage.local.get('history');
          const url = message.url;
          const filtered = url ? history.filter(h => h.url === url) : history;
          sendResponse({ success: true, history: filtered });
          break;
        }

        case 'CLEAR_HISTORY': {
          await chrome.storage.local.set({ history: [] });
          sendResponse({ success: true });
          break;
        }

        case 'ADD_TO_LIST': {
          const listKey = message.list; // 'whitelist' or 'blacklist'
          const { [listKey]: list = [] } = await chrome.storage.local.get(listKey);
          const exists = list.some(e => e.pattern === message.pattern);
          if (!exists) {
            list.push({ pattern: message.pattern, note: message.note || '', addedAt: Date.now() });
            await chrome.storage.local.set({ [listKey]: list });
          }
          sendResponse({ success: true, exists });
          break;
        }

        case 'REMOVE_FROM_LIST': {
          const listKey = message.list;
          const { [listKey]: list = [] } = await chrome.storage.local.get(listKey);
          const updated = list.filter(e => e.pattern !== message.pattern);
          await chrome.storage.local.set({ [listKey]: updated });
          sendResponse({ success: true });
          break;
        }

        case 'GET_LISTS': {
          const { whitelist = [], blacklist = [] } = await chrome.storage.local.get(['whitelist', 'blacklist']);
          sendResponse({ success: true, whitelist, blacklist });
          break;
        }

        case 'GET_SETTINGS': {
          const { settings } = await chrome.storage.local.get('settings');
          sendResponse({ success: true, settings });
          break;
        }

        case 'SAVE_SETTINGS': {
          await chrome.storage.local.set({ settings: message.settings });
          sendResponse({ success: true });
          break;
        }

        case 'RUN_TEXT_SCAN': {
          const textResult = await runTextDetection(message.text, message.url || '');
          sendResponse({ success: true, result: textResult });
          break;
        }

        case 'TEXT_SELECTED':
        case 'SELECTION_CANCELLED':
          // Forward to all extension pages (e.g. popup if open)
          try {
            chrome.runtime.sendMessage(message);
          } catch (forwardErr) {
            // Popup may not be open; ignore the error
            console.debug('[AI Checker] Could not forward message to popup:', forwardErr.message);
          }
          sendResponse({ success: true });
          break;

        default:
          sendResponse({ success: false, error: 'Unknown message type' });
      }
    } catch (error) {
      console.error('[AI Checker Background] Error:', error);
      sendResponse({ success: false, error: error.message });
    }
  })();

  return true; // Keep message channel open for async
});
