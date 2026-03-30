/**
 * AI Content Detection Utilities
 * Provides heuristic-based and API-based AI content detection
 */

'use strict';

/**
 * Heuristic text analysis for AI-generated content detection.
 * Returns a score 0-100 (higher = more likely AI-generated).
 */
function analyzeTextHeuristics(text) {
  if (!text || text.trim().length < 50) {
    return { score: 0, reasons: ['文本太短，无法分析 / Text too short to analyze'], confidence: 'low' };
  }

  const reasons = [];
  let score = 0;

  const sentences = text.match(/[^.!?]+[.!?]+/g) || [];
  if (sentences.length >= 3) {
    const lengths = sentences.map(s => s.trim().split(/\s+/).length);
    const avgLen = lengths.reduce((a, b) => a + b, 0) / lengths.length;
    const variance = lengths.reduce((a, b) => a + Math.pow(b - avgLen, 2), 0) / lengths.length;
    const stdDev = Math.sqrt(variance);
    const cv = stdDev / avgLen;

    // AI text tends to have low coefficient of variation (uniform sentence lengths)
    if (cv < 0.3 && sentences.length >= 5) {
      score += 25;
      reasons.push('句子长度高度均匀 / Highly uniform sentence lengths');
    } else if (cv < 0.45 && sentences.length >= 3) {
      score += 12;
      reasons.push('句子长度较均匀 / Moderately uniform sentence lengths');
    }

    // Check average sentence length (AI tends toward 15-25 words)
    if (avgLen >= 15 && avgLen <= 25) {
      score += 10;
      reasons.push('句子长度符合AI特征 / Sentence length typical of AI');
    }
  }

  // Lexical diversity (Type-Token Ratio)
  const words = text.toLowerCase().match(/\b[a-z\u4e00-\u9fff]+\b/g) || [];
  if (words.length > 20) {
    const uniqueWords = new Set(words);
    const ttr = uniqueWords.size / words.length;
    // AI text often has moderate TTR - not too low (repetitive) not too high (creative)
    if (ttr >= 0.35 && ttr <= 0.55 && words.length > 50) {
      score += 15;
      reasons.push('词汇多样性符合AI特征 / Vocabulary diversity typical of AI');
    }
  }

  // Check for common AI transition phrases.
  // Use non-global regexes for .test() to avoid lastIndex state issues.
  const aiPhrasePatterns = [
    /\bfurthermore\b/i,
    /\bin conclusion\b/i,
    /\bin summary\b/i,
    /\bit is worth noting\b/i,
    /\bit is important to note\b/i,
    /\bin addition\b/i,
    /\bmoreover\b/i,
    /\badditionally\b/i,
    /\boverall\b.*\bit is\b/i,
    /\bthis comprehensive\b/i,
    /\bdelve into\b/i,
    /\bultimately\b/i,
    /\btailored to\b/i,
    /\bseamlessly\b/i,
    /\bsignificant(?:ly)?\b/i,
    /\bfacilitate\b/i,
    /\bleverage\b/i,
    /\boptimize\b/i,
    /\brobust\b/i,
    /\bcomprehensive\b/i,
    // Chinese AI phrases
    /总的来说/,
    /综上所述/,
    /值得注意的是/,
    /此外/,
    /通过以上分析/,
    /综合考虑/,
    /在此基础上/
  ];

  // Cross-line patterns require separate handling
  const multilinePatterns = [
    /首先[\s\S]*?其次[\s\S]*?最后/,
    /不仅[\s\S]*?而且/
  ];

  let phraseMatches = 0;
  aiPhrasePatterns.forEach(pattern => {
    if (pattern.test(text)) phraseMatches++;
  });
  multilinePatterns.forEach(pattern => {
    if (pattern.test(text)) phraseMatches++;
  });

  if (phraseMatches >= 5) {
    score += 25;
    reasons.push(`检测到${phraseMatches}个AI常用短语 / Detected ${phraseMatches} AI-typical phrases`);
  } else if (phraseMatches >= 3) {
    score += 15;
    reasons.push(`检测到${phraseMatches}个AI常用短语 / Detected ${phraseMatches} AI-typical phrases`);
  } else if (phraseMatches >= 1) {
    score += 8;
    reasons.push(`检测到${phraseMatches}个AI常用短语 / Detected ${phraseMatches} AI-typical phrase(s)`);
  }

  // Check for perfect paragraph structure (AI tends to use 3-5 paragraphs)
  const paragraphs = text.split(/\n\s*\n/).filter(p => p.trim().length > 20);
  if (paragraphs.length >= 3 && paragraphs.length <= 6) {
    const paraLengths = paragraphs.map(p => p.split(/\s+/).length);
    const paraAvg = paraLengths.reduce((a, b) => a + b, 0) / paraLengths.length;
    const paraVariance = paraLengths.reduce((a, b) => a + Math.pow(b - paraAvg, 2), 0) / paraLengths.length;
    if (Math.sqrt(paraVariance) / paraAvg < 0.4) {
      score += 15;
      reasons.push('段落结构高度规整 / Highly regular paragraph structure');
    }
  }

  // Check for absence of personal pronouns / first person voice
  const firstPersonCount = (text.match(/\b(I|me|my|mine|myself|我|我的|我们)\b/gi) || []).length;
  const wordCount = words.length;
  if (wordCount > 100 && firstPersonCount / wordCount < 0.005) {
    score += 10;
    reasons.push('缺乏第一人称表达 / Lacks first-person voice');
  }

  // Clamp score
  score = Math.min(100, score);

  let confidence = 'low';
  if (sentences.length >= 10 || words.length >= 200) confidence = 'high';
  else if (sentences.length >= 5 || words.length >= 100) confidence = 'medium';

  return { score, reasons, confidence };
}

/**
 * Analyze image metadata for signs of AI generation.
 * Checks URL patterns and common AI image generator signatures.
 */
function analyzeImageHeuristics(imageData) {
  const reasons = [];
  let score = 0;

  const { src, alt, width, height } = imageData;

  // Check URL for known AI image generation services
  const aiImageDomains = [
    'midjourney', 'dalle', 'stability.ai', 'dreamstudio', 'nightcafe',
    'artbreeder', 'craiyon', 'wombo', 'lexica.art', 'playground.ai',
    'tensor.art', 'civitai', 'leonardo.ai', 'firefly', 'runway',
    'openai.com/images', 'cdn.openai', 'replicate.delivery',
    'image.pollinations', 'dreamlike.art'
  ];

  if (src) {
    const srcLower = src.toLowerCase();
    for (const domain of aiImageDomains) {
      if (srcLower.includes(domain)) {
        score += 80;
        reasons.push(`图片来源为已知AI图像服务 / Source from known AI image service: ${domain}`);
        break;
      }
    }

    // Check for common AI image URL patterns
    if (/[a-f0-9]{32,}/.test(src)) {
      score += 10;
      reasons.push('URL含有AI图像特征哈希 / URL contains AI image-typical hash');
    }
  }

  // Check alt text for AI generation keywords
  if (alt) {
    const altLower = alt.toLowerCase();
    const aiAltKeywords = ['generated by ai', 'ai generated', 'midjourney', 'stable diffusion', 
                          'dall-e', 'ai art', 'generated with', 'created by ai', 'ai图片', 'AI生成'];
    for (const kw of aiAltKeywords) {
      if (altLower.includes(kw)) {
        score += 60;
        reasons.push('图片描述包含AI生成标识 / Alt text indicates AI generation');
        break;
      }
    }
  }

  // Suspiciously perfect dimensions common in AI images
  const commonAIDimensions = [
    [512, 512], [768, 768], [1024, 1024], [512, 768], [768, 512],
    [768, 1024], [1024, 768], [1152, 896], [896, 1152],
    [1216, 832], [832, 1216], [1344, 768], [768, 1344]
  ];
  if (width && height) {
    for (const [w, h] of commonAIDimensions) {
      if (width === w && height === h) {
        score += 15;
        reasons.push(`图片尺寸符合AI生成规格 / Dimensions match common AI output: ${w}×${h}`);
        break;
      }
    }
  }

  score = Math.min(100, score);
  return { score, reasons, confidence: score > 0 ? 'medium' : 'low' };
}

/**
 * Analyze video element for signs of AI generation.
 */
function analyzeVideoHeuristics(videoData) {
  const reasons = [];
  let score = 0;

  const { src, poster, title } = videoData;

  const aiVideoDomains = [
    'runway', 'pika.art', 'gen-2', 'stable-video', 'lumiere',
    'emu-video', 'sora', 'videogen', 'pixverse', 'haiper',
    'luma', 'invideo.ai', 'synthesia', 'heygen', 'did.com',
    'elai.io', 'd-id.com'
  ];

  const checkText = [src, poster, title].filter(Boolean).join(' ').toLowerCase();

  for (const domain of aiVideoDomains) {
    if (checkText.includes(domain)) {
      score += 75;
      reasons.push(`视频来源为已知AI视频服务 / Source from known AI video service: ${domain}`);
      break;
    }
  }

  const aiVideoKeywords = ['ai generated', 'ai video', 'generated by ai', 'synthetic video',
                           'ai生成', 'AI视频', 'text to video', 'text-to-video'];
  for (const kw of aiVideoKeywords) {
    if (checkText.includes(kw.toLowerCase())) {
      score += 60;
      reasons.push('视频标题/来源包含AI生成标识 / Video metadata indicates AI generation');
      break;
    }
  }

  score = Math.min(100, score);
  return { score, reasons, confidence: score > 0 ? 'medium' : 'low' };
}

/**
 * Call GPTZero API for text AI detection.
 * Requires user to provide their own API key.
 */
async function callGPTZeroAPI(text, apiKey) {
  const response = await fetch('https://api.gptzero.me/v2/predict/text', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey
    },
    body: JSON.stringify({ document: text, multilingual: true })
  });

  if (!response.ok) {
    throw new Error(`GPTZero API error: ${response.status}`);
  }

  const data = await response.json();
  const doc = data.documents?.[0] || {};
  return {
    score: Math.round((doc.completely_generated_prob || 0) * 100),
    reasons: [`GPTZero检测概率: ${Math.round((doc.completely_generated_prob || 0) * 100)}%`],
    confidence: 'high',
    rawData: doc
  };
}

/**
 * Call Originality.ai API for text AI detection.
 */
async function callOriginalityAPI(text, apiKey) {
  const response = await fetch('https://api.originality.ai/api/v1/scan/ai', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-OAI-API-KEY': apiKey
    },
    body: JSON.stringify({ content: text, aiModelVersion: '1' })
  });

  if (!response.ok) {
    throw new Error(`Originality.ai API error: ${response.status}`);
  }

  const data = await response.json();
  const aiScore = data.score?.ai || 0;
  return {
    score: Math.round(aiScore * 100),
    reasons: [`Originality.ai检测概率: ${Math.round(aiScore * 100)}%`],
    confidence: 'high',
    rawData: data
  };
}

/**
 * Call Hive AI moderation for image detection.
 */
async function callHiveImageAPI(imageUrl, apiKey) {
  const response = await fetch('https://api.thehive.ai/api/v2/task/sync', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Token ${apiKey}`
    },
    body: JSON.stringify({
      url: imageUrl,
      models: ['ai_generated_detection']
    })
  });

  if (!response.ok) {
    throw new Error(`Hive API error: ${response.status}`);
  }

  const data = await response.json();
  return { score: 0, reasons: ['Hive API response received'], confidence: 'high', rawData: data };
}

/**
 * Main detection function for text content.
 */
async function detectTextAI(text, apiKeys) {
  const heuristic = analyzeTextHeuristics(text);

  // If API keys are available, use them for more accurate detection
  if (apiKeys?.gptzero && text.length >= 100) {
    try {
      const apiResult = await callGPTZeroAPI(text, apiKeys.gptzero);
      return {
        method: 'gptzero',
        ...apiResult,
        heuristicScore: heuristic.score
      };
    } catch (e) {
      console.warn('GPTZero API failed, falling back to heuristics:', e.message);
    }
  }

  if (apiKeys?.originality && text.length >= 100) {
    try {
      const apiResult = await callOriginalityAPI(text, apiKeys.originality);
      return {
        method: 'originality',
        ...apiResult,
        heuristicScore: heuristic.score
      };
    } catch (e) {
      console.warn('Originality.ai API failed, falling back to heuristics:', e.message);
    }
  }

  return {
    method: 'heuristic',
    ...heuristic
  };
}

/**
 * Main detection function for image content.
 */
async function detectImageAI(imageData, apiKeys) {
  const heuristic = analyzeImageHeuristics(imageData);

  if (apiKeys?.hive && imageData.src) {
    try {
      const apiResult = await callHiveImageAPI(imageData.src, apiKeys.hive);
      return { method: 'hive', ...apiResult, heuristicScore: heuristic.score };
    } catch (e) {
      console.warn('Hive API failed, falling back to heuristics:', e.message);
    }
  }

  return { method: 'heuristic', ...heuristic };
}

/**
 * Main detection function for video content.
 */
async function detectVideoAI(videoData) {
  const heuristic = analyzeVideoHeuristics(videoData);
  return { method: 'heuristic', ...heuristic };
}

/**
 * Get a human-readable label for a score.
 */
function getScoreLabel(score) {
  if (score >= 80) return { label: '极可能是AI生成 / Very likely AI', level: 'danger' };
  if (score >= 60) return { label: '可能是AI生成 / Likely AI', level: 'warning' };
  if (score >= 40) return { label: '部分可能是AI生成 / Possibly AI', level: 'caution' };
  if (score >= 20) return { label: '可能不是AI生成 / Unlikely AI', level: 'ok' };
  return { label: '很可能不是AI生成 / Very unlikely AI', level: 'safe' };
}

// Export for use in background script
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { detectTextAI, detectImageAI, detectVideoAI, analyzeTextHeuristics, analyzeImageHeuristics, analyzeVideoHeuristics, getScoreLabel };
}
