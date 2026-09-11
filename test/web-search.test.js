import test from 'node:test';
import assert from 'node:assert/strict';
import { TavilyWebSearch, normalizeTavilyResults, selectDiverseSources, trustBoostForUrl } from '../src/web-search.js';

test('trusted and primary-source domains receive a ranking boost', () => {
  assert.ok(trustBoostForUrl('https://www.nasa.gov/news') > trustBoostForUrl('https://example.com/post'));
  assert.ok(trustBoostForUrl('https://health.gov.vn/page') > trustBoostForUrl('https://reddit.com/r/test'));
  assert.equal(trustBoostForUrl('javascript:alert(1)'), -20);
});

test('Tavily results are normalized, sanitized and selected across domains', () => {
  const first = normalizeTavilyResults({
    results: [
      { title: '<b>Official</b>', url: 'https://nasa.gov/a', content: '<strong>Fact A</strong>', score: 0.91 },
      { title: 'Same domain', url: 'https://nasa.gov/b', content: 'Fact B', score: 0.8 },
      { title: 'Third same domain', url: 'https://nasa.gov/c', content: 'Fact C', score: 0.7 },
      { title: 'Independent', url: 'https://example.org/d', content: 'Fact D Extra context', score: 0.75 },
      { title: 'Bad URL', url: 'javascript:alert(1)', content: 'ignore', score: 1 },
    ],
  }, 'space');

  const selected = selectDiverseSources(first, 4, 2);
  assert.equal(selected.length, 3);
  assert.equal(selected[0].domain, 'nasa.gov');
  assert.equal(selected.filter((item) => item.domain === 'nasa.gov').length, 2);
  assert.ok(selected.some((item) => item.domain === 'example.org'));
  assert.ok(selected.every((item, index) => item.id === index + 1));
  assert.doesNotMatch(selected[0].title, /<b>/);
});

test('TavilyWebSearch uses basic searches, maps freshness and merges multiple queries', async () => {
  const requests = [];
  const fetchImpl = async (url, options) => {
    const body = JSON.parse(options.body);
    requests.push({ url, options, body });
    const query = body.query;
    return new Response(JSON.stringify({
      results: [
        { title: `Official ${query}`, url: `https://www.nasa.gov/${encodeURIComponent(query)}`, content: `Primary ${query}`, score: 0.9 },
        { title: `News ${query}`, url: `https://www.reuters.com/${encodeURIComponent(query)}`, content: `Independent ${query}`, score: 0.8 },
      ],
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };

  const search = new TavilyWebSearch({
    apiKey: 'test-key',
    country: 'VN',
    maxResultsPerQuery: 6,
    maxSources: 6,
    maxQueries: 2,
    fetchImpl,
  });

  const result = await search.searchMany({ queries: ['query one', 'query two', 'query ignored'], freshness: 'pw' });
  assert.equal(requests.length, 2);
  assert.equal(requests[0].options.headers.authorization, 'Bearer test-key');
  assert.equal(requests[0].body.query, 'query one');
  assert.equal(requests[0].body.country, 'vietnam');
  assert.equal(requests[0].body.time_range, 'week');
  assert.equal(requests[0].body.search_depth, 'basic');
  assert.equal(requests[0].body.auto_parameters, false);
  assert.equal(requests[0].body.include_answer, false);
  assert.equal(requests[0].body.include_raw_content, false);
  assert.equal(requests[0].body.max_results, 6);
  assert.equal(result.provider, 'tavily');
  assert.equal(result.sources.length, 4);
  assert.deepEqual(result.queries, ['query one', 'query two']);
});

test('TavilyWebSearch does not retry plan/quota errors', async () => {
  let calls = 0;
  const search = new TavilyWebSearch({
    apiKey: 'test-key',
    fetchImpl: async () => {
      calls += 1;
      return new Response(JSON.stringify({ detail: { error: 'usage limit exceeded' } }), { status: 432 });
    },
  });

  await assert.rejects(() => search.searchOne('test'), /Tavily Search HTTP 432/);
  assert.equal(calls, 1);
});
