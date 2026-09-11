import test from 'node:test';
import assert from 'node:assert/strict';
import { BraveWebSearch, normalizeBraveResults, selectDiverseSources, trustBoostForUrl } from '../src/web-search.js';

test('trusted and primary-source domains receive a ranking boost', () => {
  assert.ok(trustBoostForUrl('https://www.nasa.gov/news') > trustBoostForUrl('https://example.com/post'));
  assert.ok(trustBoostForUrl('https://health.gov.vn/page') > trustBoostForUrl('https://reddit.com/r/test'));
  assert.equal(trustBoostForUrl('javascript:alert(1)'), -20);
});

test('Brave results are normalized, sanitized and selected across domains', () => {
  const first = normalizeBraveResults({
    web: {
      results: [
        { title: '<b>Official</b>', url: 'https://nasa.gov/a', description: '<strong>Fact A</strong>' },
        { title: 'Same domain', url: 'https://nasa.gov/b', description: 'Fact B' },
        { title: 'Third same domain', url: 'https://nasa.gov/c', description: 'Fact C' },
        { title: 'Independent', url: 'https://example.org/d', description: 'Fact D', extra_snippets: ['Extra context'] },
        { title: 'Bad URL', url: 'javascript:alert(1)', description: 'ignore' },
      ],
    },
  }, 'space');

  const selected = selectDiverseSources(first, 4, 2);
  assert.equal(selected.length, 3);
  assert.equal(selected[0].domain, 'nasa.gov');
  assert.equal(selected.filter((item) => item.domain === 'nasa.gov').length, 2);
  assert.ok(selected.some((item) => item.domain === 'example.org'));
  assert.ok(selected.every((item, index) => item.id === index + 1));
  assert.doesNotMatch(selected[0].title, /<b>/);
});

test('BraveWebSearch sends independent web requests and merges multiple queries', async () => {
  const requests = [];
  const fetchImpl = async (url, options) => {
    requests.push({ url, options, body: JSON.parse(options.body) });
    const query = JSON.parse(options.body).q;
    return new Response(JSON.stringify({
      web: {
        results: [
          { title: `Official ${query}`, url: `https://www.nasa.gov/${encodeURIComponent(query)}`, description: `Primary ${query}` },
          { title: `News ${query}`, url: `https://www.reuters.com/${encodeURIComponent(query)}`, description: `Independent ${query}` },
        ],
      },
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };

  const search = new BraveWebSearch({
    apiKey: 'test-key',
    country: 'VN',
    language: 'vi',
    maxResultsPerQuery: 6,
    maxSources: 6,
    fetchImpl,
  });

  const result = await search.searchMany({ queries: ['query one', 'query two'], freshness: 'pw' });
  assert.equal(requests.length, 2);
  assert.equal(requests[0].options.headers['x-subscription-token'], 'test-key');
  assert.equal(requests[0].body.country, 'VN');
  assert.equal(requests[0].body.search_lang, 'vi');
  assert.equal(requests[0].body.freshness, 'pw');
  assert.equal(requests[0].body.extra_snippets, true);
  assert.equal(result.sources.length, 4);
  assert.deepEqual(result.queries, ['query one', 'query two']);
});
