'use strict';

/* global iina */

const iinaApi = globalThis.iina || {};
const { core, http, subtitle, utils, console: iinaConsole } = iinaApi;

if (!core || !http || !subtitle || !utils) {
  throw new Error('[SubtitleCat] Required IINA APIs are unavailable.');
}

function log(...args) {
  const target = (iinaConsole && typeof iinaConsole.log === 'function') ? iinaConsole : console;
  if (!target || typeof target.log !== 'function') {
    return;
  }
  try {
    target.log('[SubtitleCat]', ...args);
  } catch (error) {
    // Swallow logging errors to avoid breaking subtitle lookups.
  }
}

function showOsd(message) {
  if (!message) {
    return;
  }
  if (core && typeof core.osd === 'function') {
    try {
      core.osd(String(message));
      return;
    } catch (error) {
      log('showOsd failed', error);
    }
  }
  log(message);
}

const PROVIDER_ID = 'subtitlecat-zh';
const BASE_URL = 'https://www.subtitlecat.com';
const SEARCH_ENDPOINT = `${BASE_URL}/index.php`;
const DEFAULT_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
};
const KEYWORD_PATTERN = /([A-Za-z]+-\d+)/i;
const SEARCH_RESULT_LIMIT = 8;
let autoDownloadInProgress = false;
function ensureHeaders(headers = {}) {
  return { ...DEFAULT_HEADERS, ...headers };
}

async function fetchHtml(url, { headers } = {}) {
  if (!http || typeof http.get !== 'function') {
    throw new Error('SubtitleCat: IINA http API is unavailable.');
  }
  const requestOptions = {
    headers: ensureHeaders(headers),
    params: {},
    data: null,
  };
  try {
    const response = await http.get(url, requestOptions);
    if (!response || typeof response.statusCode !== 'number') {
      log('Unexpected HTTP response', { url, response });
      throw new Error('SubtitleCat: invalid HTTP response.');
    }
    return response;
  } catch (error) {
    log('fetchHtml failed', { url, message: error && error.message ? error.message : error });
    throw error;
  }
}

async function autoDownloadSubtitle() {
  if (autoDownloadInProgress) {
    return;
  }
  autoDownloadInProgress = true;
  try {
    const context = await gatherSearchItems(true);
    if (!context) {
      showOsd('SubtitleCat: unable to guess keyword automatically');
      return;
    }
    if (!context.items.length) {
      showOsd('SubtitleCat: no online subtitles found automatically');
      return;
    }
    const selected = context.items[0];
    showOsd(`SubtitleCat: downloading ${selected.title || context.keyword}`);
    const paths = await downloadItem({ data: selected });
    if (!paths.length) {
      throw new Error('Download returned no files');
    }
    core.subtitle.loadTrack(paths[0]);
    showOsd('SubtitleCat: subtitle loaded automatically');
  } catch (error) {
    log('Auto subtitle download failed', error);
    showOsd('SubtitleCat: automatic download failed');
  } finally {
    autoDownloadInProgress = false;
  }
}

// Schedule fn on the plugin's main event loop so UI APIs stay on the main thread.
function runOnMainThread(fn) {
  if (typeof setTimeout !== 'function') {
    return Promise.resolve().then(fn);
  }
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      try {
        resolve(fn());
      } catch (error) {
        reject(error);
      }
    }, 0);
  });
}

function normalizeUrl(url) {
  if (!url) {
    return '';
  }
  if (url.startsWith('http://') || url.startsWith('https://')) {
    return url;
  }
  if (url.startsWith('//')) {
    return `https:${url}`;
  }
  if (url.startsWith('/')) {
    return `${BASE_URL}${url}`;
  }
  return `${BASE_URL}/${url}`;
}

function stripTags(value) {
  return value ? value.replace(/<[^>]*>/g, ' ') : '';
}

function decodeHtmlEntities(value) {
  if (!value) {
    return '';
  }
  return value
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)));
}

function cleanText(value) {
  return decodeHtmlEntities(stripTags(value)).replace(/\s+/g, ' ').trim();
}

function extractTitle(html, fallback) {
  if (!html) {
    return fallback || 'SubtitleCat Result';
  }
  const match = html.match(/<title>(.*?)<\/title>/i);
  if (match) {
    return cleanText(match[1]);
  }
  return fallback || 'SubtitleCat Result';
}

function basenameFromPath(path) {
  if (!path) {
    return '';
  }
  const sanitized = path.replace(/[?#].*$/, '').replace(/\\/g, '/');
  const trimmed = sanitized.endsWith('/') ? sanitized.slice(0, -1) : sanitized;
  const idx = trimmed.lastIndexOf('/');
  return idx >= 0 ? trimmed.slice(idx + 1) : trimmed;
}

function stripExtension(name) {
  if (!name) {
    return '';
  }
  const idx = name.lastIndexOf('.');
  if (idx <= 0) {
    return name;
  }
  return name.slice(0, idx);
}

function tryExtractKeyword(candidate) {
  if (!candidate) {
    return null;
  }
  const match = candidate.match(KEYWORD_PATTERN);
  return match ? match[1].toUpperCase() : null;
}

function guessKeyword() {
  const status = core.status || {};
  const url = status.url || '';
  const decodedUrl = url.startsWith('file://') ? decodeURIComponent(url) : url;
  const baseName = stripExtension(basenameFromPath(decodedUrl));
  if (!baseName) {
    log('[SubtitleCat] guessKeyword: no base name from URL', url);
    return null;
  }
  const keyword = tryExtractKeyword(baseName);
  log('[SubtitleCat] guessKeyword:', { baseName, keyword });
  return keyword;
}

function sanitizeKeywordInput(input) {
  if (!input) {
    return '';
  }
  return input.trim();
}

function sanitizeFileName(name) {
  const safe = name || 'subtitle';
  return safe.replace(/[^A-Za-z0-9._-]+/g, '_');
}

function getVideoBaseName() {
  const status = core.status || {};
  const url = status.url || '';
  if (!url) {
    return null;
  }
  const decodedUrl = url.startsWith('file://') ? decodeURIComponent(url) : url;
  const base = stripExtension(basenameFromPath(decodedUrl));
  return base || null;
}

async function fetchSearchResults(keyword) {
  const url = `${SEARCH_ENDPOINT}?search=${encodeURIComponent(keyword)}`;
  log('Fetching search results', { keyword, url });
  const response = await fetchHtml(url);
  log('Search response stats', {
    keyword,
    status: response.statusCode,
    length: response.text ? response.text.length : 0,
  });
  if (response.statusCode >= 400) {
    throw new Error(`SubtitleCat search failed (${response.statusCode})`);
  }
  const parsed = parseSearchResults(response.text || '', keyword);
  log('Parsed search rows', { keyword, count: parsed.length });
  return parsed;
}

function parseSearchResults(html, keyword) {
  const rows = html.match(/<tr[\s\S]*?<\/tr>/gi) || [];
  const normalizedKeyword = (keyword || '').toLowerCase();
  const seen = new Set();
  const results = [];
  for (const row of rows) {
    const anchorMatch = row.match(/<a[^>]*href=\"([^\"]+)\"[^>]*>([\s\S]*?)<\/a>/i);
    if (!anchorMatch) {
      continue;
    }
    const rawHref = anchorMatch[1];
    const rawTitle = cleanText(anchorMatch[2]);
    if (!rawTitle) {
      continue;
    }
    const derivedTitle = rawTitle.trim();
    const hrefLooksValid = /\/(view\.php|subs)\//i.test(rawHref);
    const titleMatchesKeyword = normalizedKeyword && derivedTitle.toLowerCase().includes(normalizedKeyword);
    if (!hrefLooksValid && !titleMatchesKeyword) {
      continue;
    }
    const absoluteUrl = normalizeUrl(rawHref);
    if (seen.has(absoluteUrl)) {
      continue;
    }
    seen.add(absoluteUrl);

    const cells = row.match(/<td[\s\S]*?<\/td>/gi) || [];
    let language = '';
    if (cells.length > 1) {
      language = cleanText(cells[1]);
    }

    results.push({
      title: derivedTitle,
      url: absoluteUrl,
      language: language || 'Unknown',
    });

    if (results.length >= SEARCH_RESULT_LIMIT * 2) {
      break;
    }
  }
  const summary = {
    keyword,
    totalRows: rows.length,
    kept: results.length,
  };
  if (!rows.length) {
    summary.preview = (html || '').slice(0, 500);
  }
  log('parseSearchResults complete', summary);
  return results;
}

async function fetchDetail(url) {
  log('Fetching detail page', url);
  const response = await fetchHtml(url);
  if (response.statusCode >= 400) {
    throw new Error(`SubtitleCat detail request failed (${response.statusCode})`);
  }
  const parsed = parseDetailPage(response.text || '', url);
  log('Parsed detail page', { url, simplified: parsed.simplified, traditional: parsed.traditional });
  return parsed;
}

function parseDetailPage(html, url) {
  const info = {
    url,
    pageTitle: extractTitle(html, 'SubtitleCat Result'),
    simplified: false,
    traditional: false,
    downloadLinks: {},
  };

  const linkRegex = /<a([^>]*)>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = linkRegex.exec(html)) !== null) {
    const attrs = match[1] || '';
    const inner = match[2] || '';
    const classesMatch = attrs.match(/class=\"([^\"]+)\"/i);
    const classes = classesMatch ? classesMatch[1].toLowerCase() : '';
    if (!classes.includes('green-link')) {
      continue;
    }
    const hrefMatch = attrs.match(/href=\"([^\"]+)\"/i);
    if (!hrefMatch) {
      continue;
    }
    const href = normalizeUrl(hrefMatch[1]);
    const label = cleanText(inner).toLowerCase();
    const combined = `${label} ${attrs.toLowerCase()}`;

    const hasDownloadHint = combined.includes('download');
    if (!hasDownloadHint) {
      continue;
    }
    if (combined.includes('zh-cn') || label.includes('简') || label.includes('simplified')) {
      info.downloadLinks['zh-CN'] = href;
      info.simplified = true;
    }
    if (combined.includes('zh-tw') || label.includes('繁') || label.includes('traditional')) {
      info.downloadLinks['zh-TW'] = href;
      info.traditional = true;
    }
  }

  return info;
}

function pickDownloadLink(detail) {
  if (!detail || !detail.downloadLinks) {
    return null;
  }
  if (detail.downloadLinks['zh-CN']) {
    return { language: 'zh-CN', url: detail.downloadLinks['zh-CN'] };
  }
  if (detail.downloadLinks['zh-TW']) {
    return { language: 'zh-TW', url: detail.downloadLinks['zh-TW'] };
  }
  return null;
}

async function searchWithKeyword(keyword) {
  const results = await fetchSearchResults(keyword);
  if (!results.length) {
    return [];
  }

  const items = [];
  for (const result of results.slice(0, SEARCH_RESULT_LIMIT)) {
    try {
      const detail = await fetchDetail(result.url);
      const downloadInfo = pickDownloadLink(detail);
      if (!downloadInfo) {
        log('Skipping result without zh download', result.url);
        continue;
      }
      items.push({
        title: result.title || detail.pageTitle,
        keyword,
        pageUrl: result.url,
        language: result.language,
        chosenLanguage: downloadInfo.language,
        downloadUrl: downloadInfo.url,
        simplifiedAvailable: detail.simplified,
        traditionalAvailable: detail.traditional,
        pageTitle: detail.pageTitle,
      });
    } catch (error) {
      log('Failed to inspect result', result.url, error);
    }
  }
  log('searchWithKeyword summary', {
    keyword,
    totalResults: results.length,
    returned: items.length,
  });
  return items;
}

async function gatherSearchItems(autoOnly = false) {
  const guessed = guessKeyword();
  if (guessed) {
    log(`Trying auto keyword: ${guessed}`);
    showOsd(`SubtitleCat: searching ${guessed}`);
    const autoItems = await searchWithKeyword(guessed);
    if (!autoItems.length) {
      log(`No Chinese subtitles for ${guessed}`);
    }
    return { keyword: guessed, items: autoItems };
  }

  if (autoOnly) {
    return null;
  }

  const manualInput = await runOnMainThread(() => utils.prompt('SubtitleCat keyword (e.g. NIMA-014)'));
  const manualKeyword = sanitizeKeywordInput(manualInput);
  if (!manualKeyword) {
    return null;
  }
  showOsd(`SubtitleCat: searching ${manualKeyword}`);
  const manualItems = await searchWithKeyword(manualKeyword);
  return { keyword: manualKeyword, items: manualItems };
}

async function searchProvider(autoOnly = false) {
  const searchContext = await gatherSearchItems(autoOnly);
  if (!searchContext) {
    return [];
  }
  const { keyword, items } = searchContext;
  if (!items.length) {
    showOsd(`SubtitleCat: no subtitles for "${keyword}"`);
    throw new Error(`SubtitleCat: no Chinese results for "${keyword}".`);
  }
  log(`Returning ${items.length} results for ${keyword}`);
  return items.map((data) => subtitle.item(data));
}

function describeItem(item) {
  const data = item.data || {};
  const lang = data.chosenLanguage === 'zh-CN' ? '简体 zh-CN' : '繁體 zh-TW';
  const status = data.language ? `Source: ${data.language}` : 'SubtitleCat';
  return {
    name: data.title || data.pageTitle || 'SubtitleCat Result',
    left: lang,
    right: `${status}`,
  };
}

async function downloadItem(item) {
  const data = item.data || {};
  if (!data.downloadUrl) {
    throw new Error('SubtitleCat: missing download URL.');
  }
  const baseName = getVideoBaseName() || data.keyword || 'subtitle';
  const suffix = data.chosenLanguage || 'zh';
  const fileName = `${sanitizeFileName(baseName)}.${suffix}.srt`;
  const targetPath = `@tmp/${fileName}`;
  await http.download(data.downloadUrl, targetPath, { headers: DEFAULT_HEADERS });
  log(`Downloaded ${fileName}`);
  return [targetPath];
}

try {
  subtitle.registerProvider(PROVIDER_ID, {
    search: searchProvider,
    description: describeItem,
    download: downloadItem,
  });
  log('Subtitle provider registered.');
} catch (error) {
  console.error('[SubtitleCat] Failed to register provider', error);
}
