const DEFAULT_ENDPOINT = 'https://api.search.brave.com/res/v1/web/search';

const HIGH_TRUST_DOMAINS = new Set([
  'reuters.com', 'apnews.com', 'afp.com', 'bbc.com', 'nature.com', 'science.org',
  'who.int', 'un.org', 'worldbank.org', 'imf.org', 'oecd.org', 'europa.eu',
  'nasa.gov', 'nih.gov', 'cdc.gov', 'fda.gov', 'noaa.gov', 'weather.gov',
]);

const COMMUNITY_DOMAINS = new Set([
  'reddit.com', 'quora.com', 'facebook.com', 'x.com', 'twitter.com', 'tiktok.com',
  'instagram.com', 'medium.com',
]);

function cleanText(value, maxLength = 6000) {
  return String(value || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function safeHttpUrl(value) {
  try {
    const url = new URL(String(value || ''));
    return ['http:', 'https:'].includes(url.protocol) ? url.toString() : '';
  } catch {
    return '';
  }
}

function hostname(value) {
  try { return new URL(value).hostname.replace(/^www\./, '').toLowerCase(); }
  catch { return ''; }
}

function domainMatches(host, domain) {
  return host === domain || host.endsWith(`.${domain}`);
}

export function trustBoostForUrl(url, trustedDomains = []) {
  const host = hostname(url);
  if (!host) return -20;
  if (trustedDomains.some((domain) => domainMatches(host, domain))) return 12;
  if (host.endsWith('.gov') || host.includes('.gov.')) return 10;
  if (host.endsWith('.edu') || host.includes('.edu.')) return 8;
  if (host.endsWith('.int')) return 9;
  if (HIGH_TRUST_DOMAINS.has(host) || [...HIGH_TRUST_DOMAINS].some((domain) => domainMatches(host, domain))) return 7;
  if (COMMUNITY_DOMAINS.has(host) || [...COMMUNITY_DOMAINS].some((domain) => domainMatches(host, domain))) return -4;
  return 0;
}

export function normalizeBraveResults(payload, query, trustedDomains = []) {
  const rows = Array.isArray(payload?.web?.results) ? payload.web.results : [];
  return rows.flatMap((row, index) => {
    const url = safeHttpUrl(row?.url);
    if (!url) return [];
    const snippets = [row?.description, ...(Array.isArray(row?.extra_snippets) ? row.extra_snippets : [])]
      .map((item) => cleanText(item, 2200))
      .filter(Boolean);
    return [{
      query,
      title: cleanText(row?.title || hostname(url), 500),
      url,
      domain: hostname(url),
      snippet: cleanText(snippets.join(' '), 5200),
      age: cleanText(row?.age || row?.page_age || '', 120),
      rank: index + 1,
      score: 100 - index * 3 + trustBoostForUrl(url, trustedDomains),
    }];
  });
}

export function selectDiverseSources(results, maxSources = 8, maxPerDomain = 2) {
  const seenUrls = new Set();
  const perDomain = new Map();
  const sorted = [...results].sort((a, b) => b.score - a.score || a.rank - b.rank);
  const selected = [];
  for (const item of sorted) {
    const key = item.url.replace(/#.*$/, '').replace(/\/$/, '');
    if (seenUrls.has(key)) continue;
    const count = perDomain.get(item.domain) || 0;
    if (count >= maxPerDomain) continue;
    seenUrls.add(key);
    perDomain.set(item.domain, count + 1);
    selected.push(item);
    if (selected.length >= maxSources) break;
  }
  return selected.map(({ score, rank, ...source }, index) => ({ ...source, id: index + 1 }));
}

function abortSignal(parent, timeoutMs) {
  const timeout = AbortSignal.timeout(timeoutMs);
  return parent ? AbortSignal.any([parent, timeout]) : timeout;
}

function retryDelay(response, attempt) {
  const retryAfter = Number(response?.headers?.get?.('retry-after'));
  if (Number.isFinite(retryAfter) && retryAfter > 0) return Math.min(5000, retryAfter * 1000);
  return Math.min(2500, 500 * (2 ** attempt));
}

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    if (!signal) return;
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason || new DOMException('Aborted', 'AbortError'));
    };
    if (signal.aborted) return onAbort();
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

export class BraveWebSearch {
  constructor({ apiKey, endpoint = DEFAULT_ENDPOINT, country = '', language = '', maxResultsPerQuery = 8, maxSources = 8, trustedDomains = [], timeoutMs = 15000, fetchImpl = fetch } = {}) {
    this.apiKey = String(apiKey || '').trim();
    this.endpoint = String(endpoint || DEFAULT_ENDPOINT).trim();
    this.country = String(country || '').trim().toUpperCase();
    this.language = String(language || '').trim().toLowerCase();
    this.maxResultsPerQuery = Math.max(2, Math.min(20, Number(maxResultsPerQuery) || 8));
    this.maxSources = Math.max(2, Math.min(20, Number(maxSources) || 8));
    this.trustedDomains = trustedDomains.map((item) => String(item).trim().replace(/^www\./, '').toLowerCase()).filter(Boolean);
    this.timeoutMs = Math.max(1000, Number(timeoutMs) || 15000);
    this.fetchImpl = fetchImpl;
  }

  async searchOne(query, { freshness = '', signal } = {}) {
    if (!this.apiKey) throw new Error('Web search chưa có BRAVE_SEARCH_API_KEY.');
    const body = {
      q: String(query || '').trim().slice(0, 600),
      count: this.maxResultsPerQuery,
      extra_snippets: true,
      safesearch: 'moderate',
    };
    if (!body.q) return [];
    if (this.country) body.country = this.country;
    if (this.language) body.search_lang = this.language;
    if (['pd', 'pw', 'pm', 'py'].includes(freshness)) body.freshness = freshness;

    let lastError;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const requestSignal = abortSignal(signal, this.timeoutMs);
      let response;
      try {
        response = await this.fetchImpl(this.endpoint, {
          method: 'POST',
          headers: {
            accept: 'application/json',
            'content-type': 'application/json',
            'x-subscription-token': this.apiKey,
          },
          body: JSON.stringify(body),
          signal: requestSignal,
        });
      } catch (error) {
        if (signal?.aborted || error?.name === 'AbortError') throw error;
        lastError = error;
        if (attempt < 2) await sleep(500 * (2 ** attempt), signal);
        continue;
      }

      if (response.ok) {
        const payload = await response.json();
        return normalizeBraveResults(payload, body.q, this.trustedDomains);
      }

      const detail = cleanText(await response.text().catch(() => ''), 1000);
      lastError = new Error(`Brave Search HTTP ${response.status}: ${detail || response.statusText}`);
      if (![429, 500, 502, 503, 504].includes(response.status) || attempt >= 2) throw lastError;
      await sleep(retryDelay(response, attempt), signal);
    }
    throw lastError || new Error('Brave Search thất bại.');
  }

  async searchMany({ queries = [], freshness = '', signal } = {}) {
    const cleaned = [...new Set(queries.map((q) => String(q || '').trim()).filter(Boolean))].slice(0, 3);
    const all = [];
    for (const query of cleaned) {
      const rows = await this.searchOne(query, { freshness, signal });
      all.push(...rows);
    }
    return {
      provider: 'brave',
      queries: cleaned,
      freshness: freshness || null,
      sources: selectDiverseSources(all, this.maxSources, 2),
    };
  }
}
