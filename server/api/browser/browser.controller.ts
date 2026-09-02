import { Body, Controller, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { SandboxBrowserExecutor } from '../../browser/browser-executor.js';
import type { BrowserAction } from '../../browser/browser-policy.js';
import { InMemoryApprovalCoordinator } from '../../agent/approval-coordinator.js';
import { AppError, toPublicError } from '../../domain/errors/app-error.js';
import { createHash } from 'node:crypto';

@Controller('api/browser')
export class BrowserController {
  private readonly pending = new Map<string, { hash: string; actions: readonly BrowserAction[] }>();
  constructor(
    private readonly browser: SandboxBrowserExecutor,
    private readonly approvals: InMemoryApprovalCoordinator
  ) {}

  @Post('execute')
  async execute(@Body() body: unknown, @Req() request: Request, @Res() response: Response): Promise<void> {
    try {
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw new AppError('invalid_request');
      const value = body as { actions?: unknown; approved?: unknown; approvalId?: unknown };
      if (!Array.isArray(value.actions)) throw new AppError('invalid_request');
      const actions = value.actions.filter(isBrowserAction);
      if (actions.length !== value.actions.length) throw new AppError('invalid_request');
      const approvalId = typeof value.approvalId === 'string' ? value.approvalId : undefined;
      const hash = createHash('sha256').update(JSON.stringify(actions)).digest('hex');
      if (actions.some((action) => action.type === 'click') && value.approved !== true) {
        const approval = this.approvals.request(actions.map((action) => ({ name: `browser.${action.type}`, arguments: JSON.stringify(action) })), Date.now, request.signal);
        this.pending.set(approval.id, { hash, actions: Object.freeze([...actions]) });
        response.status(202).json({ status: 'pending_approval', approvalId: approval.id });
        return;
      }
      if (actions.some((action) => action.type === 'click')) {
        if (!approvalId || this.pending.get(approvalId)?.hash !== hash || this.approvals.status(approvalId)?.decision !== 'approved') throw new AppError('browser_denied');
        this.pending.delete(approvalId);
      }
      const result = await this.browser.execute(actions, request.signal, value.approved === true);
      response.status(200).json({ results: result });
    } catch (error) {
      const publicError = toPublicError(error);
      response.status(publicError.status).json(publicError.body);
    }
  }
}

function isBrowserAction(value: unknown): value is BrowserAction {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  if (item.type === 'navigate') return typeof item.url === 'string';
  if (item.type === 'click') return typeof item.selector === 'string';
  if (item.type === 'extract_text') return item.selector === undefined || typeof item.selector === 'string';
  return item.type === 'screenshot';
}
