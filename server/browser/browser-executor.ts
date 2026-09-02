import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { AppError } from '../domain/errors/app-error.js';
import { BrowserPolicy, type BrowserAction } from './browser-policy.js';

export interface BrowserExecutionResult {
  readonly type: BrowserAction['type'];
  readonly url: string;
  readonly text?: string;
  readonly imageBase64?: string;
}

export interface BrowserExecutorOptions {
  readonly browser?: Browser;
  readonly policy?: BrowserPolicy;
}

export class SandboxBrowserExecutor {
  private readonly policy: BrowserPolicy;
  private readonly browser?: Browser;

  constructor(options: BrowserExecutorOptions = {}) {
    this.policy = options.policy ?? new BrowserPolicy({ allowedDomains: [] });
    this.browser = options.browser;
  }

  async execute(actions: readonly BrowserAction[], signal: AbortSignal, approved = false): Promise<readonly BrowserExecutionResult[]> {
    if (!Array.isArray(actions) || actions.length === 0 || actions.length > this.policy.maxActions) throw new AppError('browser_denied');
    if (actions.some((action) => action.type === 'click') && !approved) throw new AppError('browser_denied');
    if (signal.aborted) throw new AppError('request_aborted');
    const browser = this.browser ?? await this.launch();
    let context: BrowserContext | undefined;
    const startedAt = Date.now();
    try {
      context = await browser.newContext({ javaScriptEnabled: true, acceptDownloads: false, serviceWorkers: 'block' });
      await context.route('**/*', async (route) => {
        try {
          await this.policy.assertUrlAllowed(route.request().url());
          await route.continue();
        } catch {
          await route.abort('blockedbyclient');
        }
      });
      const page = await context.newPage();
      const results: BrowserExecutionResult[] = [];
      for (const action of actions) {
        this.policy.assertAction(action, results.length);
        if (signal.aborted) throw new AppError('request_aborted');
        if (Date.now() - startedAt > this.policy.maxDurationMs) throw new AppError('browser_denied');
        if (action.type === 'navigate') {
          const url = await this.policy.assertUrlAllowed(action.url);
          await page.goto(url.toString(), { waitUntil: 'domcontentloaded', timeout: this.policy.maxDurationMs });
          results.push({ type: action.type, url: page.url() });
        } else if (action.type === 'click') {
          await page.locator(action.selector).first().click({ timeout: this.policy.maxDurationMs });
          results.push({ type: action.type, url: page.url() });
        } else if (action.type === 'extract_text') {
          const text = await (action.selector ? page.locator(action.selector).first().innerText() : page.locator('body').innerText());
          results.push({ type: action.type, url: page.url(), text: text.slice(0, this.policy.maxTextChars) });
        } else {
          const image = await page.screenshot({ type: 'png', animations: 'disabled' });
          if (image.byteLength > 2 * 1024 * 1024) throw new AppError('browser_denied');
          results.push({ type: action.type, url: page.url(), imageBase64: image.toString('base64') });
        }
      }
      return Object.freeze(results);
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError('browser_unavailable');
    } finally {
      await context?.close().catch(() => undefined);
      if (!this.browser) await browser.close().catch(() => undefined);
    }
  }

  private async launch(): Promise<Browser> {
    try {
      return await chromium.launch({ headless: true, chromiumSandbox: true });
    } catch {
      throw new AppError('browser_unavailable');
    }
  }
}
