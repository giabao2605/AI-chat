const DEFAULT_ENDPOINT = 'https://api.tavily.com/search';

const HIGH_TRUST_DOMAINS = new Set([
  'reuters.com', 'apnews.com', 'afp.com', 'bbc.com', 'nature.com', 'science.org',
  'who.int', 'un.org', 'worldbank.org', 'imf.org', 'oecd.org', 'europa.eu',
  'nasa.gov', 'nih.gov', 'cdc.gov', 'fda.gov', 'noaa.gov', 'weather.gov',
]);

const COMMUNITY_DOMAINS = new Set([
  'reddit.com', 'quora.com', 'facebook.com', 'x.com', 'twitter.com', 'tiktok.com',
  'instagram.com', 'medium.com',
]);

const COUNTRY_ALIASES = new Map([
  ['vn', 'vietnam'], ['vi', 'vietnam'], ['us', 'united states'], ['usa', 'united states'],
  ['uk', 'united kingdom'], ['gb', 'united kingdom'], ['sg', 'singapore'], ['jp', 'japan'],
  ['kr', 'south korea'], ['au', 'australia'], ['ca', 'canada'], ['de', 'germany'], ['fr', 'france'],
]);

const TIME_RANGE_MAP = {
  pd: 'day',
  pw: 'week',
  pm: 'month',
  py: 'year',
};

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

function normalizeCountry(value) {
  const country = String(value || '').trim().toLowerCase();
  return COUNTRY_ALIASES.get(country) || country;
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

export function normalizeTavilyResults(payload, query, trustedDomains = []) {
  const rows = Array.isArray(payload?.results) ? payload.results : [];
  return rows.flatMap((row, index) => {
    const url = safeHttpUrl(row?.url);
    if (!url) return [];
    const providerScore = Number(row?.score);
    const relevance = Number.isFinite(providerScore) ? Math.max(0, Math.min(1, providerScore)) * 100 : 100 - index * 3;
    return [{
      query,
      title: cleanText(row?.title || hostname(url), 500),
      url,
      domain: hostname(url),
      snippet: cleanText(row?.content || '', 5200),
      age: cleanText(row?.published_date || row?.publishedDate || '', 120),
      rank: index + 1,
      score: relevance + trustBoostForUrl(url, trustedDomains),
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

export class TavilyWebSearch {
  constructor({ apiKey, endpoint = DEFAULT_ENDPOINT, country = '', maxResultsPerQuery = 8, maxSources = 8, maxQueries = 2, trustedDomains = [], timeoutMs = 15000, fetchImpl = fetch } = {}) {
    this.apiKey = String(apiKey || '').trim();
    this.endpoint = String(endpoint || DEFAULT_ENDPOINT).trim();
    this.country = normalizeCountry(country);
    this.maxResultsPerQuery = Math.max(2, Math.min(20, Number(maxResultsPerQuery) || 8));
    this.maxSources = Math.max(2, Math.min(20, Number(maxSources) || 8));
    this.maxQueries = Math.max(1, Math.min(3, Number(maxQueries) || 2));
    this.trustedDomains = trustedDomains.map((item) => String(item).trim().replace(/^www\./, '').toLowerCase()).filter(Boolean);
    this.timeoutMs = Math.max(1000, Number(timeoutMs) || 15000);
    this.fetchImpl = fetchImpl;
  }

  async searchOne(query, { freshness = '', signal } = {}) {
    if (!this.apiKey) throw new Error('Web search chưa có TAVILY_API_KEY.');
    const body = {
      query: String(query || '').trim().slice(0, 600),
      search_depth: 'basic',
      chunks_per_source: 3,
      max_results: this.maxResultsPerQuery,
      topic: 'general',
      include_answer: false,
      include_raw_content: false,
      include_images: false,
      auto_parameters: false,
      safe_search: true,
    };
    if (!body.query) return [];
    if (this.country) body.country = this.country;
    if (TIME_RANGE_MAP[freshness]) body.time_range = TIME_RANGE_MAP[freshness];

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
            authorization: `Bearer ${this.apiKey}`,
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
        return normalizeTavilyResults(payload, body.query, this.trustedDomains);
      }

      const detail = cleanText(await response.text().catch(() => ''), 1000);
      lastError = new Error(`Tavily Search HTTP ${response.status}: ${detail || response.statusText}`);
      if (![429, 500, 502, 503, 504].includes(response.status) || attempt >= 2) throw lastError;
      await sleep(retryDelay(response, attempt), signal);
    }
    throw lastError || new Error('Tavily Search thất bại.');
  }

  async searchMany({ queries = [], freshness = '', signal } = {}) {
    const cleaned = [...new Set(queries.map((q) => String(q || '').trim()).filter(Boolean))].slice(0, this.maxQueries);
    const all = [];
    for (const query of cleaned) {
      const rows = await this.searchOne(query, { freshness, signal });
      all.push(...rows);
    }
    return {
      provider: 'tavily',
      queries: cleaned,
      freshness: freshness || null,
      sources: selectDiverseSources(all, this.maxSources, 2),
    };
  }
}
