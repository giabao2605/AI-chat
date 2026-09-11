import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

function cleanText(value, maxLength = 12000) {
  return String(value || '')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<!--([\s\S]*?)-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function isPrivateIpv4(host) {
  const parts = host.split('.').map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  return parts[0] === 0
    || parts[0] === 10
    || parts[0] === 127
    || (parts[0] === 169 && parts[1] === 254)
    || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31)
    || (parts[0] === 192 && parts[1] === 168)
    || (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127)
    || parts[0] >= 224;
}

function isPrivateIpv6(host) {
  const value = host.toLowerCase();
  return value === '::1'
    || value === '::'
    || value.startsWith('fc')
    || value.startsWith('fd')
    || /^fe[89ab]/.test(value)
    || value.startsWith('ff')
    || value.startsWith('2001:db8:');
}

function isPrivateIp(value) {
  const version = isIP(value);
  if (version === 4) return isPrivateIpv4(value);
  if (version === 6) return isPrivateIpv6(value);
  return false;
}

export function safeResearchUrl(value) {
  try {
    const url = new URL(String(value || ''));
    if (!['http:', 'https:'].includes(url.protocol)) return '';
    const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    if (!host || host === 'localhost' || host.endsWith('.localhost') || isPrivateIp(host)) return '';
    url.username = '';
    url.password = '';
    url.hash = '';
    return url.toString();
  } catch {
    return '';
  }
}

async function hostIsPublic(host) {
  if (isIP(host)) return !isPrivateIp(host);
  try {
    const answers = await lookup(host, { all: true, verbatim: true });
    return answers.length > 0 && answers.every((answer) => !isPrivateIp(answer.address));
  } catch {
    return false;
  }
}

function requestSignal(parent, timeoutMs) {
  const timeout = AbortSignal.timeout(timeoutMs);
  return parent ? AbortSignal.any([parent, timeout]) : timeout;
}

async function fetchSafe(urlValue, { timeoutMs, signal, fetchImpl, redirects = 3 }) {
  let current = safeResearchUrl(urlValue);
  for (let hop = 0; hop <= redirects; hop += 1) {
    if (!current) return null;
    const parsed = new URL(current);
    if (!await hostIsPublic(parsed.hostname)) return null;
    const response = await fetchImpl(current, {
      method: 'GET',
      redirect: 'manual',
      headers: {
        accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.2',
        'user-agent': 'AI-Conversation-Lab/2.0 research-reader',
      },
      signal: requestSignal(signal, timeoutMs),
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      if (!location) return null;
      current = safeResearchUrl(new URL(location, current).toString());
      continue;
    }
    return response;
  }
  return null;
}

export async function enrichResearchSources(sources = [], {
  enabled = true,
  maxSources = 2,
  maxCharsPerSource = 9000,
  timeoutMs = 9000,
  signal,
  fetchImpl = fetch,
} = {}) {
  if (!enabled || maxSources <= 0 || !Array.isArray(sources) || !sources.length) return sources;
  const targets = sources.slice(0, maxSources);
  const enriched = new Map();

  await Promise.allSettled(targets.map(async (source) => {
    const url = safeResearchUrl(source?.url);
    if (!url) return;
    const response = await fetchSafe(url, { timeoutMs, signal, fetchImpl });
    if (!response?.ok) return;
    const type = String(response.headers.get('content-type') || '').toLowerCase();
    if (!type.includes('text/') && !type.includes('html') && !type.includes('xml')) return;
    const raw = (await response.text()).slice(0, Math.max(maxCharsPerSource * 5, 20000));
    const deepContent = cleanText(raw, maxCharsPerSource);
    if (deepContent.length < 250) return;
    enriched.set(source.url, { ...source, deepContent });
  }));

  return sources.map((source) => enriched.get(source.url) || source);
}

export function buildDeepEvidenceText(sources = []) {
  return sources.map((source) => {
    const content = cleanText(source?.deepContent || source?.snippet || '', 10000);
    return `[${source.id}] ${source.title || source.domain || 'Nguồn'}\nURL: ${source.url}\n${content}`;
  }).join('\n\n');
}
