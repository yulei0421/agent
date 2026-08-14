import { Injectable } from '@nestjs/common';

const API_KEY_PLACEHOLDER = '在这里填写你的apikey';

export interface AppConfig {
  port: number;
  clientUrl: string;
  trustProxy: boolean;
  deepSeekApiKey?: string;
  deepSeekBaseUrl: string;
  deepSeekModel: string;
  pdfFontPath?: string;
  modelResilience: ModelResilienceConfig;
}

export interface ModelResilienceConfig {
  totalTimeoutMs: number;
  firstEventTimeoutMs: number;
  idleTimeoutMs: number;
  maxRetries: 0 | 1;
  circuitFailureThreshold: number;
  circuitCooldownMs: number;
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

function readBoundedInteger(value: string | undefined, fallback: number, name: string, minimum: number, maximum: number): number {
  if (value === undefined || value === '') return fallback;
  if (!/^\d+$/u.test(value)) throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`);
  }
  return parsed;
}

function readAbsoluteFilePath(value: string | undefined, name: string): string | undefined {
  if (value === undefined || value === '') return undefined;
  if (!value.startsWith('/') || value.length > 1_024 || /[\u0000\r\n]/u.test(value)) throw new Error(`${name} must be an absolute file path`);
  return value;
}

export function parseAppConfig(environment: NodeJS.ProcessEnv): AppConfig {
  const deepSeekApiKey = environment.DEEPSEEK_API_KEY;
  const pdfFontPath = readAbsoluteFilePath(environment.PDF_CJK_FONT_PATH, 'PDF_CJK_FONT_PATH');
  if (deepSeekApiKey === API_KEY_PLACEHOLDER) throw new Error('DEEPSEEK_API_KEY must not use the placeholder value');

  return {
    port: readPort(environment.PORT),
    clientUrl: readHttpOrigin(environment.CLIENT_URL, 'http://127.0.0.1:5173', 'CLIENT_URL'),
    trustProxy: readBoolean(environment.TRUST_PROXY),
    ...(deepSeekApiKey ? { deepSeekApiKey } : {}),
    deepSeekBaseUrl: readHttpOrigin(environment.DEEPSEEK_BASE_URL, 'https://api.deepseek.com', 'DEEPSEEK_BASE_URL'),
    deepSeekModel: environment.DEEPSEEK_MODEL || 'deepseek-v4-flash',
    ...(pdfFontPath ? { pdfFontPath } : {}),
    modelResilience: {
      totalTimeoutMs: readBoundedInteger(environment.MODEL_TOTAL_TIMEOUT_MS, 60000, 'MODEL_TOTAL_TIMEOUT_MS', 100, 120000),
      firstEventTimeoutMs: readBoundedInteger(environment.MODEL_FIRST_EVENT_TIMEOUT_MS, 15000, 'MODEL_FIRST_EVENT_TIMEOUT_MS', 100, 120000),
      idleTimeoutMs: readBoundedInteger(environment.MODEL_IDLE_TIMEOUT_MS, 30000, 'MODEL_IDLE_TIMEOUT_MS', 100, 120000),
      maxRetries: readBoundedInteger(environment.MODEL_MAX_RETRIES, 1, 'MODEL_MAX_RETRIES', 0, 1) as 0 | 1,
      circuitFailureThreshold: readBoundedInteger(
        environment.MODEL_CIRCUIT_FAILURE_THRESHOLD,
        3,
        'MODEL_CIRCUIT_FAILURE_THRESHOLD',
        1,
        20
      ),
      circuitCooldownMs: readBoundedInteger(environment.MODEL_CIRCUIT_COOLDOWN_MS, 30000, 'MODEL_CIRCUIT_COOLDOWN_MS', 100, 120000)
    }
  };
}

@Injectable()
export class AppConfigService {
  readonly value: AppConfig;

  constructor(config: AppConfig = parseAppConfig(process.env)) {
    this.value = config;
  }
}
