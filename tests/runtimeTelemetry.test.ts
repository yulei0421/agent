import assert from 'node:assert/strict';
import test from 'node:test';
import type { ToolExecutor } from '../server/domain/tools/tool.types.js';
import { InstrumentedToolExecutor } from '../server/infrastructure/runtime/instrumented-tool-executor.js';
import { RuntimeTelemetry } from '../server/infrastructure/runtime/runtime-telemetry.js';

function executor(result: Awaited<ReturnType<ToolExecutor['execute']>>): ToolExecutor {
  return {
    definitions: () => [],
    execute: async () => result
  };
}

test('publishes fixed tool, provider, freshness, and latency labels without caller data', async () => {
  const telemetry = new RuntimeTelemetry();
  const tools = new InstrumentedToolExecutor(executor({
    ok: true,
    name: 'get_quote',
    result: { data: {}, meta: { source: 'binance', ageSeconds: 31 } }
  }), telemetry, () => 100);

  await tools.execute({
    name: 'get_quote',
    arguments: '{"symbol":"private user prompt https://model.example/api?key=secret"}'
  });
  const metrics = telemetry.metrics();

  assert.match(metrics, /agent_tool_calls_by_name_total\{tool="get_quote",outcome="success"\} 1/);
  assert.match(metrics, /agent_tool_duration_milliseconds_bucket\{tool="get_quote",le="100"\} 1/);
  assert.match(metrics, /agent_tool_freshness_total\{tool="get_quote",status="fresh"\} 1/);
  assert.match(metrics, /agent_external_source_recent_status\{source="binance",status="success"\} 1/);
  assert.doesNotMatch(metrics, /private user prompt|model\.example|secret|https?:/);
});

test('ignores unregistered tools and converts missing freshness and unsafe providers to fixed labels', async () => {
  const telemetry = new RuntimeTelemetry();
  const tools = new InstrumentedToolExecutor(executor({
    ok: true,
    name: 'unknown',
    result: { meta: { source: 'https://untrusted.example', ageSeconds: 3 } }
  }), telemetry, () => 5);

  await tools.execute({ name: 'unregistered_user_input', arguments: '{}' });
  telemetry.recordTool('get_quote', true, 5, { meta: { source: 'https://untrusted.example' } });
  const metrics = telemetry.metrics();

  assert.doesNotMatch(metrics, /unregistered_user_input|untrusted\.example/);
  assert.match(metrics, /agent_tool_freshness_total\{tool="get_quote",status="unknown"\} 1/);
  assert.match(metrics, /agent_external_source_recent_status\{source="unknown",status="success"\} 1/);
});

test('records only the newly registered technical and economic-calendar labels', () => {
  const telemetry = new RuntimeTelemetry();
  telemetry.recordTool('get_technical_indicators', true, 9, { meta: { source: 'yahoo-finance', ageSeconds: 12 } });
  telemetry.recordTool('get_economic_calendar', true, 9, { meta: { source: 'forexfactory' } });
  const metrics = telemetry.metrics();

  assert.match(metrics, /tool="get_technical_indicators",outcome="success"\} 1/);
  assert.match(metrics, /tool="get_economic_calendar",status="unknown"\} 1/);
  assert.match(metrics, /source="forexfactory",status="success"\} 1/);
});

test('counts model failovers without recording model configuration or request data', () => {
  const telemetry = new RuntimeTelemetry();
  telemetry.recordModelFailover();
  telemetry.recordModelFailover();
  const metrics = telemetry.metrics();

  assert.match(metrics, /agent_model_failover_total 2/);
  assert.doesNotMatch(metrics, /fallback\.example|private user prompt|secret/);
});
