import { Injectable } from '@nestjs/common';
import type { ModelTaskType } from '../../application/chat/chat.ports.js';

const API_KEY_PLACEHOLDER = '在这里填写你的apikey';

export interface AppConfig {
  port: number;
  clientUrl: string;
  trustProxy: boolean;
  deepSeekApiKey?: string;
  deepSeekBaseUrl: string;
  deepSeekModel: string;
  modelFallback?: {
    apiKey: string;
    baseUrl: string;
    model: string;
  };
  modelRoutes?: Partial<Record<ModelTaskType, ModelRouteConfig>>;
  pdfFontPath?: string;
  ocrLanguage: string;
  tesseractLangPath?: string;
  tesseractWorkerPath?: string;
  tesseractCorePath?: string;
  browserAllowedDomains?: readonly string[];
  embedding?: { apiKey: string; endpoint: string; model: string };
  desktopSessionToken?: string;
  staticRendererDir?: string;
  modelResilience: ModelResilienceConfig;
}

export interface ModelRouteConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
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

function readOcrLanguage(value: string | undefined): string {
  const candidate = value || 'chi_sim+eng';
  if (candidate.length > 64 || !/^[A-Za-z0-9_+.-]+$/u.test(candidate)) throw new Error('OCR_LANGUAGE must contain only language codes separated by +');
  return candidate;
}

function readBrowserDomains(value: string | undefined): readonly string[] {
  if (!value) return [];
  const domains = value.split(',').map((item) => item.trim().toLowerCase()).filter(Boolean);
  if (domains.length > 32 || domains.some((domain) => !/^(?:[a-z0-9-]+\.)+[a-z]{2,}$/u.test(domain))) throw new Error('BROWSER_ALLOWED_DOMAINS must contain public DNS names');
  return Object.freeze([...new Set(domains)]);
}

function readDesktopSessionToken(value: string | undefined): string | undefined {
  if (!value) return undefined;
  if (!/^[A-Za-z0-9_-]{24,256}$/u.test(value)) throw new Error('DESKTOP_SESSION_TOKEN must be a base64url token between 24 and 256 characters');
  return value;
}

function readModelRoutes(environment: NodeJS.ProcessEnv): Partial<Record<ModelTaskType, ModelRouteConfig>> | undefined {
  const routeNames: readonly [ModelTaskType, string][] = [
    ['fast', 'FAST'],
    ['reasoning', 'REASONING'],
    ['structured', 'STRUCTURED']
  ];
  const routes: Partial<Record<ModelTaskType, ModelRouteConfig>> = {};
  for (const [taskType, suffix] of routeNames) {
    const apiKey = environment[`MODEL_${suffix}_API_KEY`];
    const baseUrl = environment[`MODEL_${suffix}_BASE_URL`];
    const model = environment[`MODEL_${suffix}_NAME`];
    const configured = Boolean(apiKey || baseUrl || model);
    if (!configured) continue;
    if (!apiKey || !baseUrl || !model) throw new Error(`MODEL_${suffix}_API_KEY, MODEL_${suffix}_BASE_URL, and MODEL_${suffix}_NAME must be configured together`);
    if (apiKey === API_KEY_PLACEHOLDER) throw new Error(`MODEL_${suffix}_API_KEY must not use the placeholder value`);
    routes[taskType] = { apiKey, baseUrl: readHttpOrigin(baseUrl, '', `MODEL_${suffix}_BASE_URL`), model };
  }
  return Object.keys(routes).length > 0 ? routes : undefined;
}

export function parseAppConfig(environment: NodeJS.ProcessEnv): AppConfig {
  const deepSeekApiKey = environment.DEEPSEEK_API_KEY;
  const fallbackApiKey = environment.MODEL_FALLBACK_API_KEY;
  const fallbackBaseUrl = environment.MODEL_FALLBACK_BASE_URL;
  const fallbackModel = environment.MODEL_FALLBACK_NAME;
  const hasFallbackConfiguration = Boolean(fallbackApiKey || fallbackBaseUrl || fallbackModel);
  const pdfFontPath = readAbsoluteFilePath(environment.PDF_CJK_FONT_PATH, 'PDF_CJK_FONT_PATH');
  const ocrLanguage = readOcrLanguage(environment.OCR_LANGUAGE);
  const tesseractLangPath = readAbsoluteFilePath(environment.TESSERACT_LANG_PATH, 'TESSERACT_LANG_PATH');
  const tesseractWorkerPath = readAbsoluteFilePath(environment.TESSERACT_WORKER_PATH, 'TESSERACT_WORKER_PATH');
  const tesseractCorePath = readAbsoluteFilePath(environment.TESSERACT_CORE_PATH, 'TESSERACT_CORE_PATH');
  const browserAllowedDomains = readBrowserDomains(environment.BROWSER_ALLOWED_DOMAINS);
  const desktopSessionToken = readDesktopSessionToken(environment.DESKTOP_SESSION_TOKEN);
  const staticRendererDir = readAbsoluteFilePath(environment.STATIC_RENDERER_DIR, 'STATIC_RENDERER_DIR');
  if (Boolean(desktopSessionToken) !== Boolean(staticRendererDir)) throw new Error('DESKTOP_SESSION_TOKEN and STATIC_RENDERER_DIR must be configured together');
  const embeddingConfigured = Boolean(environment.EMBEDDING_API_KEY || environment.EMBEDDING_ENDPOINT || environment.EMBEDDING_MODEL);
  if (embeddingConfigured && (!environment.EMBEDDING_API_KEY || !environment.EMBEDDING_ENDPOINT || !environment.EMBEDDING_MODEL)) throw new Error('EMBEDDING_API_KEY, EMBEDDING_ENDPOINT, and EMBEDDING_MODEL must be configured together');
  const modelRoutes = readModelRoutes(environment);
  if (deepSeekApiKey === API_KEY_PLACEHOLDER) throw new Error('DEEPSEEK_API_KEY must not use the placeholder value');
  if (hasFallbackConfiguration && (!fallbackApiKey || !fallbackBaseUrl || !fallbackModel)) {
    throw new Error('MODEL_FALLBACK_API_KEY, MODEL_FALLBACK_BASE_URL, and MODEL_FALLBACK_NAME must be configured together');
  }
  if (fallbackApiKey === API_KEY_PLACEHOLDER) throw new Error('MODEL_FALLBACK_API_KEY must not use the placeholder value');

  return {
    port: readPort(environment.PORT),
    clientUrl: readHttpOrigin(environment.CLIENT_URL, 'http://127.0.0.1:5173', 'CLIENT_URL'),
    trustProxy: readBoolean(environment.TRUST_PROXY),
    ...(deepSeekApiKey ? { deepSeekApiKey } : {}),
    deepSeekBaseUrl: readHttpOrigin(environment.DEEPSEEK_BASE_URL, 'https://api.deepseek.com', 'DEEPSEEK_BASE_URL'),
    deepSeekModel: environment.DEEPSEEK_MODEL || 'deepseek-v4-flash',
    ...(hasFallbackConfiguration
      ? {
        modelFallback: {
          apiKey: fallbackApiKey!,
          baseUrl: readHttpOrigin(fallbackBaseUrl, '', 'MODEL_FALLBACK_BASE_URL'),
          model: fallbackModel!
        }
      }
      : {}),
    ...(modelRoutes ? { modelRoutes } : {}),
    ...(pdfFontPath ? { pdfFontPath } : {}),
    ocrLanguage,
    ...(tesseractLangPath ? { tesseractLangPath } : {}),
    ...(tesseractWorkerPath ? { tesseractWorkerPath } : {}),
    ...(tesseractCorePath ? { tesseractCorePath } : {}),
    ...(browserAllowedDomains.length > 0 ? { browserAllowedDomains } : {}),
    ...(desktopSessionToken ? { desktopSessionToken } : {}),
    ...(staticRendererDir ? { staticRendererDir } : {}),
    ...(embeddingConfigured ? { embedding: { apiKey: environment.EMBEDDING_API_KEY!, endpoint: readHttpOrigin(environment.EMBEDDING_ENDPOINT, '', 'EMBEDDING_ENDPOINT'), model: environment.EMBEDDING_MODEL! } } : {}),
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
