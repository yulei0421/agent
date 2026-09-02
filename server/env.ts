import { existsSync, readFileSync } from 'node:fs';

export function loadEnv(file = '.env', environment: NodeJS.ProcessEnv = process.env): void {
  if (!existsSync(file)) return;
  const lines = readFileSync(file, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const index = trimmed.indexOf('=');
    if (index === -1) continue;
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim();
    if (!environment[key]) environment[key] = value;
  }
}

export function loadConfiguredEnv(environment: NodeJS.ProcessEnv = process.env): void {
  loadEnv(environment.AGENT_ENV_FILE || '.env', environment);
}
