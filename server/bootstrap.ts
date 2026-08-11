import { bootstrap } from './main.js';
import { loadEnv } from './env.js';

loadEnv();

void bootstrap().catch((error: unknown) => {
  console.error('Failed to start server:', error);
  process.exitCode = 1;
});
