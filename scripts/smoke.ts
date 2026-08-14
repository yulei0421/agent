const baseUrl = process.env.SMOKE_BASE_URL;

if (!baseUrl) {
  process.stdout.write('Smoke test skipped: set SMOKE_BASE_URL to run against a deployed service.\n');
  process.exit(0);
}

let origin: URL;
try {
  origin = new URL(baseUrl);
} catch {
  throw new Error('SMOKE_BASE_URL must be an absolute HTTP(S) origin');
}
if (origin.protocol !== 'http:' && origin.protocol !== 'https:') throw new Error('SMOKE_BASE_URL must use HTTP(S)');

const response = await fetch(new URL('/api/health', origin));
if (!response.ok) throw new Error(`Health smoke test failed with HTTP ${response.status}`);
const body = await response.json() as { status?: unknown };
if (body.status !== 'ok') throw new Error('Health smoke test returned an unexpected body');
process.stdout.write(`Smoke test passed: ${origin.origin}/api/health\n`);
