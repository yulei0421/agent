import { bootstrap } from './main.js';

void bootstrap().catch((error: unknown) => {
  console.error('Failed to start server:', error);
  process.exitCode = 1;
});
