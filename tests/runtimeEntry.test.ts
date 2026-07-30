import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('production scripts start the Nest runtime instead of the legacy Express entrypoint', async () => {
  const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')) as {
    scripts?: Record<string, string>;
  };

  assert.match(manifest.scripts?.server ?? '', /server\/bootstrap\.ts/);
  assert.match(manifest.scripts?.dev ?? '', /server\/bootstrap\.ts/);
  assert.doesNotMatch(manifest.scripts?.server ?? '', /server\/index\.ts/);
});
