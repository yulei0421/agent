import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('package manifest exposes Electron development and production build commands', () => {
  const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
    scripts?: Record<string, string>;
    build?: { appId?: string; directories?: { output?: string }; asarUnpack?: string[] };
  };
  assert.ok(manifest.scripts?.['desktop:dev']);
  assert.ok(manifest.scripts?.['desktop:build']);
  assert.equal(manifest.build?.appId, 'com.deepseek.agent.demo');
  assert.equal(manifest.build?.directories?.output, 'release');
  assert.ok(manifest.build?.asarUnpack?.includes('dist-server/**'));
});
