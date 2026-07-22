import { Injectable } from '@nestjs/common';

const API_KEY_PLACEHOLDER = '在这里填写你的apikey';

export interface AppConfig {
  port: number;
  clientUrl: string;
  trustProxy: boolean;
  deepSeekApiKey?: string;
  deepSeekBaseUrl: string;
  deepSeekModel: string;
}

function readPort(value: string | undefined): number {
  if (value === undefined || value === '') return 8787;
  if (!/^\d+$/u.test(value)) throw new Error('PORT must be an integer between 1 and 65535');
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be an integer between 1 and 65535');
  return port;
}

function readHttpOrigin(value: string | undefined, fallback: string, name: string): string {
  const candidate = value || fallback;
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    throw new Error(`${name} must be an absolute HTTP(S) URL`);
  }
  if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.pathname !== '/' || url.search || url.hash) {
    throw new Error(`${name} must be an origin without a path, query, or fragment`);
  }
  return url.origin;
}

function readBoolean(value: string | undefined, fallback = false): boolean {
  if (value === undefined || value === '') return fallback;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new Error('TRUST_PROXY must be true or false');
}

export function parseAppConfig(environment: NodeJS.ProcessEnv): AppConfig {
  const deepSeekApiKey = environment.DEEPSEEK_API_KEY;
  if (deepSeekApiKey === API_KEY_PLACEHOLDER) throw new Error('DEEPSEEK_API_KEY must not use the placeholder value');

  return {
    port: readPort(environment.PORT),
    clientUrl: readHttpOrigin(environment.CLIENT_URL, 'http://127.0.0.1:5173', 'CLIENT_URL'),
    trustProxy: readBoolean(environment.TRUST_PROXY),
    ...(deepSeekApiKey ? { deepSeekApiKey } : {}),
    deepSeekBaseUrl: readHttpOrigin(environment.DEEPSEEK_BASE_URL, 'https://api.deepseek.com', 'DEEPSEEK_BASE_URL'),
    deepSeekModel: environment.DEEPSEEK_MODEL || 'deepseek-v4-flash'
  };
}

@Injectable()
export class AppConfigService {
  readonly value: AppConfig;

  constructor() {
    this.value = parseAppConfig(process.env);
  }
}
