import assert from 'node:assert/strict';
import test from 'node:test';
import { CitationProxyService } from '../server/application/citations/citation-proxy.service.js';

test('stores an auditable snapshot with content and request hashes', () => {
  const service = new CitationProxyService();
  const citation = service.record({ tool: 'get_quote', source: 'provider:binance', label: 'BTC/USDT', payload: { price: 1 }, request: '{"symbol":"BTC"}', now: new Date('2026-09-01T00:00:00Z') });
  assert.equal(citation.contentHash.length, 64);
  assert.equal(citation.provenance[0]?.requestHash.length, 64);
  assert.equal(service.get(citation.id).source, 'provider:binance');
});

test('marks old snapshots stale and supports controlled revalidation', async () => {
  const service = new CitationProxyService(async (source) => ({ source, label: 'refreshed', payload: { ok: true } }), { staleAfterMs: 1 });
  const citation = service.record({ tool: 'search_news', source: 'news:1', label: 'headline', payload: {}, now: new Date('2026-09-01T00:00:00Z') });
  assert.equal(service.get(citation.id, new Date('2026-09-01T00:00:00.010Z')).freshness, 'stale');
  const refreshed = await service.revalidate(citation.id, new AbortController().signal, new Date('2026-09-01T00:00:01Z'));
  assert.equal(refreshed.label, 'refreshed');
});
