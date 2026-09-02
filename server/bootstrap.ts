import { bootstrap } from './main.js';
import { loadConfiguredEnv } from './env.js';

loadConfiguredEnv();

void bootstrap().catch((error: unknown) => {
  console.error('Failed to start server:', error);
  process.exitCode = 1;
});
