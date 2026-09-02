import { isIP } from 'node:net';
import { lookup } from 'node:dns/promises';
import { AppError } from '../domain/errors/app-error.js';

export type BrowserAction =
  | { type: 'navigate'; url: string }
  | { type: 'click'; selector: string }
  | { type: 'extract_text'; selector?: string }
  | { type: 'screenshot' };

export interface BrowserPolicyOptions {
  readonly allowedDomains?: readonly string[];
  readonly maxActions?: number;
  readonly maxDurationMs?: number;
  readonly maxTextChars?: number;
}

export class BrowserPolicy {
  readonly allowedDomains: readonly string[];
  readonly maxActions: number;
  readonly maxDurationMs: number;
  readonly maxTextChars: number;

  constructor(options: BrowserPolicyOptions = {}) {
    this.allowedDomains = Object.freeze((options.allowedDomains ?? []).map((item) => item.toLowerCase().replace(/^\.+/u, '')).filter(Boolean));
    this.maxActions = options.maxActions ?? 8;
    this.maxDurationMs = options.maxDurationMs ?? 30_000;
    this.maxTextChars = options.maxTextChars ?? 20_000;
  }

  async assertUrlAllowed(raw: string): Promise<URL> {
    let url: URL;
    try { url = new URL(raw); } catch { throw new AppError('browser_denied'); }
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.port && !['80', '443'].includes(url.port)) throw new AppError('browser_denied');
    const host = url.hostname.toLowerCase();
    if (isIP(host) !== 0 && isPrivateAddress(host)) throw new AppError('browser_denied');
    if (!this.allowedDomains.some((domain) => host === domain || host.endsWith(`.${domain}`))) throw new AppError('browser_denied');
    try {
      const addresses = await lookup(host, { all: true });
      if (addresses.some((entry) => isPrivateAddress(entry.address))) throw new AppError('browser_denied');
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError('browser_denied');
    }
    return url;
  }

  assertAction(action: BrowserAction, count: number): void {
    if (count >= this.maxActions || !action || typeof action !== 'object') throw new AppError('browser_denied');
    if (action.type === 'click' && (!action.selector || action.selector.length > 256 || /[<>]/u.test(action.selector))) throw new AppError('browser_denied');
    if (action.type === 'extract_text' && action.selector && action.selector.length > 256) throw new AppError('browser_denied');
  }
}

function isPrivateAddress(address: string): boolean {
  if (address === 'localhost' || address === '::1' || address.startsWith('127.') || address.startsWith('10.') || address.startsWith('192.168.') || address.startsWith('169.254.')) return true;
  const octets = address.split('.').map(Number);
  const [first, second] = octets;
  return octets.length === 4 && first !== undefined && second !== undefined && ((first === 172 && second >= 16 && second <= 31) || first === 0);
}
