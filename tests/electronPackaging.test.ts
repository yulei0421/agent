import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

test('package manifest exposes Electron development and production build commands', () => {
  const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
    scripts?: Record<string, string>;
    dependencies?: Record<string, string>;
    build?: { appId?: string; directories?: { output?: string }; asarUnpack?: string[] };
  };
  assert.ok(manifest.scripts?.['desktop:dev']);
  assert.ok(manifest.scripts?.['desktop:build']);
  assert.equal(manifest.build?.appId, 'com.deepseek.agent.demo');
  assert.equal(manifest.build?.directories?.output, 'release');
  assert.ok(manifest.build?.asarUnpack?.includes('dist-server/**'));
});

test('package manifest declares LangGraph peer dependencies for packaged sidecar resolution', () => {
  const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
    dependencies?: Record<string, string>;
  };
  assert.ok(manifest.dependencies?.['@langchain/core']);
  assert.ok(manifest.dependencies?.zod);
});

test('Electron preload output is compiled in a CommonJS package scope', () => {
  const config = JSON.parse(readFileSync(new URL('../tsconfig.electron.json', import.meta.url), 'utf8')) as {
    compilerOptions?: { module?: string };
  };
  const electronPackage = JSON.parse(readFileSync(new URL('../electron/package.json', import.meta.url), 'utf8')) as {
    type?: string;
  };
  const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
    scripts?: Record<string, string>;
  };
  assert.equal(config.compilerOptions?.module, 'Node16');
  assert.equal(electronPackage.type, 'commonjs');
  assert.match(manifest.scripts?.['build:electron'] ?? '', /build-electron-package/u);
  const compiledPreload = new URL('../dist-electron/preload.js', import.meta.url);
  if (existsSync(compiledPreload)) {
    assert.doesNotMatch(readFileSync(compiledPreload, 'utf8'), /^\s*import\s/mu);
  }
});
