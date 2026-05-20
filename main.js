'use strict';

/* global iina */

const iinaApi = globalThis.iina || {};
const { core, http, subtitle, utils, preferences, console: iinaConsole } = iinaApi;

if (!core || !http || !subtitle || !utils) {
  throw new Error('[SubtitleCat] Required IINA APIs are unavailable.');
}

class SubtitleCat {
  static PROVIDER_ID = 'subtitlecat-zh';
  static BASE_URL = 'https://www.subtitlecat.com';
  static SEARCH_ENDPOINT = `${SubtitleCat.BASE_URL}/index.php`;
  static DEFAULT_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
  };
  static KEYWORD_PATTERN = /([A-Za-z]+-\d+)/i;
  static SEARCH_RESULT_LIMIT = 8;
  static PREFERRED_LANGUAGE_PREF_KEY = 'preferredLanguage';
  static PREFERRED_LANGUAGE_DEFAULT = 'zh-TW';

  // --- Logging ---

  log(...args) {
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

  showOsd(message) {
    if (!message) {
      return;
    }
    if (core && typeof core.osd === 'function') {
      try {
        core.osd(String(message));
        return;
      } catch (error) {
        this.log('showOsd failed', error);
      }
    }
    this.log(message);
  }

  // --- Preferences ---

  getPreferenceValue(key, fallback) {
    if (!preferences || typeof preferences.get !== 'function') {
      return fallback;
    }
    try {
      const value = preferences.get(key);
      return typeof value === 'undefined' ? fallback : value;
    } catch (error) {
      this.log('getPreferenceValue failed', { key, error });
      return fallback;
    }
  }

  // --- Utilities ---

  ensureHeaders(headers = {}) {
    return { ...SubtitleCat.DEFAULT_HEADERS, ...headers };
  }

  // Schedule fn on the plugin's main event loop so UI APIs stay on the main thread.
  runOnMainThread(fn) {
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

  normalizeUrl(url) {
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
      return `${SubtitleCat.BASE_URL}${url}`;
    }
    return `${SubtitleCat.BASE_URL}/${url}`;
  }

  stripTags(value) {
    return value ? value.replace(/<[^>]*>/g, ' ') : '';
  }

  decodeHtmlEntities(value) {
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

  cleanText(value) {
    return this.decodeHtmlEntities(this.stripTags(value)).replace(/\s+/g, ' ').trim();
  }

  extractTitle(html, fallback) {
    if (!html) {
      return fallback || 'SubtitleCat Result';
    }
    const match = html.match(/<title>(.*?)<\/title>/i);
    if (match) {
      return this.cleanText(match[1]);
    }
    return fallback || 'SubtitleCat Result';
  }

  basenameFromPath(path) {
    if (!path) {
      return '';
    }
    const sanitized = path.replace(/[?#].*$/, '').replace(/\\/g, '/');
    const trimmed = sanitized.endsWith('/') ? sanitized.slice(0, -1) : sanitized;
    const idx = trimmed.lastIndexOf('/');
    return idx >= 0 ? trimmed.slice(idx + 1) : trimmed;
  }

  stripExtension(name) {
    if (!name) {
      return '';
    }
    const idx = name.lastIndexOf('.');
    if (idx <= 0) {
      return name;
    }
    return name.slice(0, idx);
  }

  sanitizeKeywordInput(input) {
    if (!input) {
      return '';
    }
    return input.trim();
  }

  // --- Video context ---

  guessKeyword() {
    const status = core.status || {};
    const url = status.url || '';
    const decodedUrl = url.startsWith('file://') ? decodeURIComponent(url) : url;
    const baseName = this.stripExtension(this.basenameFromPath(decodedUrl));
    if (!baseName) {
      this.log('guessKeyword: no base name from URL', url);
      return null;
    }
    const match = baseName.match(SubtitleCat.KEYWORD_PATTERN);
    const keyword = match ? match[1].toUpperCase() : null;
    this.log('guessKeyword:', { baseName, keyword });
    return keyword;
  }

  // --- HTTP ---

  async fetchHtml(url, { headers } = {}) {
    if (!http || typeof http.get !== 'function') {
      throw new Error('SubtitleCat: IINA http API is unavailable.');
    }
    const requestOptions = {
      headers: this.ensureHeaders(headers),
      params: {},
      data: null,
    };
    try {
      const response = await http.get(url, requestOptions);
      if (!response || typeof response.statusCode !== 'number') {
        this.log('Unexpected HTTP response', { url, response });
        throw new Error('SubtitleCat: invalid HTTP response.');
      }
      return response;
    } catch (error) {
      this.log('fetchHtml failed', { url, message: error && error.message ? error.message : error });
      throw error;
    }
  }

  // --- Parsing ---

  parseSearchResults(html, keyword) {
    const rows = html.match(/<tr[\s\S]*?<\/tr>/gi) || [];
    const normalizedKeyword = (keyword || '').toLowerCase();
    const seen = new Set();
    const results = [];
    for (const row of rows) {
      const anchorMatch = row.match(/<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
      if (!anchorMatch) {
        continue;
      }
      const rawHref = anchorMatch[1];
      const rawTitle = this.cleanText(anchorMatch[2]);
      if (!rawTitle) {
        continue;
      }
      const derivedTitle = rawTitle.trim();
      const hrefLooksValid = /\/(view\.php|subs)\//i.test(rawHref);
      const titleMatchesKeyword = normalizedKeyword && derivedTitle.toLowerCase().includes(normalizedKeyword);
      if (!hrefLooksValid && !titleMatchesKeyword) {
        continue;
      }
      const absoluteUrl = this.normalizeUrl(rawHref);
      if (seen.has(absoluteUrl)) {
        continue;
      }
      seen.add(absoluteUrl);

      results.push({
        title: derivedTitle,
        url: absoluteUrl,
      });

      if (results.length >= SubtitleCat.SEARCH_RESULT_LIMIT * 2) {
        break;
      }
    }
    const summary = { keyword, totalRows: rows.length, kept: results.length };
    if (!rows.length) {
      summary.preview = (html || '').slice(0, 500);
    }
    this.log('parseSearchResults complete', summary);
    return results;
  }

  parseDetailPage(html, url) {
    const info = {
      url,
      pageTitle: this.extractTitle(html, 'SubtitleCat Result'),
      downloadLinks: {},
    };

    const linkRegex = /<a([^>]+)>/gi;
    let match;
    while ((match = linkRegex.exec(html)) !== null) {
      const attrs = match[1] || '';
      if (!attrs.includes('green-link')) continue;
      const idMatch = attrs.match(/id="download_([^"]+)"/i);
      if (!idMatch) continue;
      const langCode = idMatch[1];
      const hrefMatch = attrs.match(/href="([^"]+)"/i);
      if (!hrefMatch) continue;
      info.downloadLinks[langCode] = this.normalizeUrl(hrefMatch[1]);
    }

    return info;
  }

  getPreferred() {
    return String(this.getPreferenceValue(SubtitleCat.PREFERRED_LANGUAGE_PREF_KEY, SubtitleCat.PREFERRED_LANGUAGE_DEFAULT));
  }

  // --- Search pipeline ---

  async fetchSearchResults(keyword) {
    const url = `${SubtitleCat.SEARCH_ENDPOINT}?search=${encodeURIComponent(keyword)}`;
    this.log('Fetching search results', { keyword, url });
    const response = await this.fetchHtml(url);
    this.log('Search response stats', {
      keyword,
      status: response.statusCode,
      length: response.text ? response.text.length : 0,
    });
    if (response.statusCode >= 400) {
      throw new Error(`SubtitleCat search failed (${response.statusCode})`);
    }
    const parsed = this.parseSearchResults(response.text || '', keyword);
    this.log('Parsed search rows', { keyword, count: parsed.length });
    return parsed;
  }

  async fetchDetail(url) {
    this.log('Fetching detail page', url);
    const response = await this.fetchHtml(url);
    if (response.statusCode >= 400) {
      throw new Error(`SubtitleCat detail request failed (${response.statusCode})`);
    }
    const parsed = this.parseDetailPage(response.text || '', url);
    this.log('Parsed detail page', { url, links: Object.keys(parsed.downloadLinks) });
    return parsed;
  }

  async searchWithKeyword(keyword) {
    const results = await this.fetchSearchResults(keyword);
    if (!results.length) {
      return [];
    }

    const preferred = this.getPreferred();
    const tuples = [];
    for (const result of results.slice(0, SubtitleCat.SEARCH_RESULT_LIMIT)) {
      try {
        const detail = await this.fetchDetail(result.url);
        for (const [langCode, url] of Object.entries(detail.downloadLinks)) {
          tuples.push({
            title: result.title || detail.pageTitle,
            keyword,
            langCode,
            url,
          });
        }
      } catch (error) {
        this.log('Failed to inspect result', result.url, error);
      }
    }

    tuples.sort((a, b) => {
      const aPref = a.langCode === preferred ? 0 : 1;
      const bPref = b.langCode === preferred ? 0 : 1;
      if (aPref !== bPref) return aPref - bPref;
      if (a.title < b.title) return -1;
      if (a.title > b.title) return 1;
      if (a.langCode < b.langCode) return -1;
      if (a.langCode > b.langCode) return 1;
      return 0;
    });

    this.log('searchWithKeyword summary', { keyword, returned: tuples.length });
    return tuples;
  }

  async gatherSearchItems(autoOnly = false) {
    const guessed = this.guessKeyword();
    if (guessed) {
      this.log(`Trying auto keyword: ${guessed}`);
      this.showOsd(`SubtitleCat: searching ${guessed}`);
      const autoItems = await this.searchWithKeyword(guessed);
      if (!autoItems.length) {
        this.log(`No subtitles found for ${guessed}`);
      }
      return { keyword: guessed, items: autoItems };
    }

    if (autoOnly) {
      return null;
    }

    const manualInput = await this.runOnMainThread(() => utils.prompt('SubtitleCat keyword (e.g. NIMA-014)'));
    const manualKeyword = this.sanitizeKeywordInput(manualInput);
    if (!manualKeyword) {
      return null;
    }
    this.showOsd(`SubtitleCat: searching ${manualKeyword}`);
    const manualItems = await this.searchWithKeyword(manualKeyword);
    return { keyword: manualKeyword, items: manualItems };
  }

  // --- Provider interface ---

  async search(autoOnly = false) {
    const searchContext = await this.gatherSearchItems(autoOnly);
    if (!searchContext) {
      return [];
    }
    const { keyword, items } = searchContext;
    if (!items.length) {
      this.showOsd(`SubtitleCat: no subtitles for "${keyword}"`);
      throw new Error(`SubtitleCat: no subtitles found for "${keyword}".`);
    }
    this.log(`Returning ${items.length} results for ${keyword}`);
    return items.map((data) => subtitle.item(data));
  }

  describe(item) {
    const data = item.data || {};
    return {
      name: data.title || 'SubtitleCat Result',
      left: data.langCode || '',
      right: '',
    };
  }

  async download(item) {
    const data = item.data || {};
    if (!data.url) {
      throw new Error('SubtitleCat: missing download URL.');
    }
    const keyword = (data.keyword || 'subtitle').replace(/[^A-Za-z0-9._-]+/g, '_');
    const fileName = `${keyword}.${data.langCode}.srt`;
    const targetPath = `@tmp/${fileName}`;
    await http.download(data.url, targetPath, { headers: SubtitleCat.DEFAULT_HEADERS });
    this.log(`Downloaded ${fileName}`);
    return [targetPath];
  }

  // --- Registration ---

  register() {
    const provider = this;
    subtitle.registerProvider(SubtitleCat.PROVIDER_ID, {
      search: (autoOnly) => provider.search(autoOnly),
      description: (item) => provider.describe(item),
      download: (item) => provider.download(item),
    });
    this.log('Subtitle provider registered.');
  }
}

try {
  new SubtitleCat().register();
} catch (error) {
  console.error('[SubtitleCat] Failed to register provider', error);
}
