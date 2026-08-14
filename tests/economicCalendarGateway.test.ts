import assert from 'node:assert/strict';
import test from 'node:test';
import { createEconomicCalendarGateway } from '../server/economic-calendar/gateway.js';

test('reads the weekly calendar from its fixed public source and exposes only validated fields', async () => {
  const requests: string[] = [];
  const gateway = createEconomicCalendarGateway({
    fetchImpl: async (url) => {
      requests.push(url);
      return {
        ok: true,
        status: 200,
        json: async () => [{
          date: '2026-07-20T12:30:00-04:00', country: 'USD', title: 'Consumer Price Index', impact: 'High', actual: 'https://private.example', forecast: '2.5%', previous: '2.4%'
        }]
      };
    },
    now: () => new Date('2026-07-20T00:00:00.000Z')
  });

  assert.deepEqual(await gateway.getWeek(), {
    ok: true,
    source: 'forexfactory',
    fetchedAt: '2026-07-20T00:00:00.000Z',
    events: [{
      time: '2026-07-20T16:30:00.000Z', country: 'US', title: 'Consumer Price Index', impact: 'high', forecast: '2.5%', previous: '2.4%'
    }]
  });
  assert.deepEqual(requests, ['https://nfs.faireconomy.media/ff_calendar_thisweek.json']);
});

test('drops calendar text fields containing IP literals', async () => {
  const gateway = createEconomicCalendarGateway({
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      json: async () => [{
        date: '2026-07-20T12:30:00Z', country: 'US', title: '203.0.113.7 release', impact: 'High', actual: '2.5%'
      }]
    })
  });

  const result = await gateway.getWeek();
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error('Expected a calendar response');
  assert.deepEqual(result.events, []);
});

test('drops calendar text fields containing IPv6 literals', async () => {
  const gateway = createEconomicCalendarGateway({
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      json: async () => [{
        date: '2026-07-20T12:30:00Z', country: 'US', title: '2001:db8::1 release', impact: 'High'
      }]
    })
  });

  const result = await gateway.getWeek();
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error('Expected a calendar response');
  assert.deepEqual(result.events, []);
});

test('maps a cancelled calendar request to request_aborted', async () => {
  const controller = new AbortController();
  const gateway = createEconomicCalendarGateway({
    fetchImpl: async (_url, options) => {
      controller.abort();
      assert.equal(options?.signal?.aborted, true);
      throw new Error('aborted');
    }
  });

  assert.deepEqual(await gateway.getWeek({ signal: controller.signal }), { ok: false, errorCode: 'request_aborted' });
});

test('treats a stalled calendar JSON body as unavailable within the gateway timeout', async () => {
  const gateway = createEconomicCalendarGateway({
    timeoutMs: 5,
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => new Promise(() => {}) })
  });

  assert.deepEqual(await gateway.getWeek(), { ok: false, errorCode: 'calendar_unavailable' });
});
