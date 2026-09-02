import { randomBytes } from 'node:crypto';
import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { AppError } from '../domain/errors/app-error.js';

export type ApprovalDecision = 'approved' | 'rejected';
export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'expired' | 'cancelled';

export interface ApprovalRequest {
  id: string;
  status: ApprovalStatus;
  decision: ApprovalDecision;
}

export interface ApprovalCall {
  id?: string;
  name: string;
  arguments: string;
}

export interface PendingApprovalHandle {
  id: string;
  status: 'pending';
  wait: Promise<ApprovalRequest>;
}

interface PendingApproval {
  readonly id: string;
  readonly resolve: (result: ApprovalRequest) => void;
  readonly cleanup: () => void;
  readonly expiresAt: number;
}

@Injectable()
export class InMemoryApprovalCoordinator implements OnModuleDestroy {
  private readonly pending = new Map<string, PendingApproval>();
  private readonly decisions = new Map<string, ApprovalRequest>();
  private readonly ttlMs: number;

  constructor(options: { ttlMs?: number } = {}) {
    this.ttlMs = options.ttlMs ?? 2 * 60_000;
  }

  request(calls: readonly ApprovalCall[], now: () => number = Date.now, signal?: AbortSignal): PendingApprovalHandle {
    if (!calls.length || !calls.every((call) => call && typeof call.name === 'string' && call.name.length > 0 && call.name.length <= 64 && typeof call.arguments === 'string' && call.arguments.length <= 8_192)) {
      throw new AppError('invalid_request');
    }
    const id = randomBytes(18).toString('base64url');
    let resolveWait!: (result: ApprovalRequest) => void;
    const wait = new Promise<ApprovalRequest>((resolve) => {
      resolveWait = resolve;
    });
    const createdAt = now();
    let entry: PendingApproval | undefined;
    const timer = setTimeout(() => {
      if (!entry || this.pending.get(id) !== entry) return;
      this.pending.delete(id);
      entry.cleanup();
      resolveWait({ id, status: 'expired', decision: 'rejected' });
    }, Math.max(0, createdAt + this.ttlMs - now()));

    const onAbort = () => {
      if (!entry || this.pending.get(id) !== entry) return;
      this.pending.delete(id);
      entry.cleanup();
      resolveWait({ id, status: 'cancelled', decision: 'rejected' });
    };
    if (signal) {
      if (signal.aborted) {
        clearTimeout(timer);
        resolveWait({ id, status: 'cancelled', decision: 'rejected' });
        return { id, status: 'pending', wait };
      }
      signal.addEventListener('abort', onAbort, { once: true });
    }

    entry = {
      id,
      resolve: resolveWait,
      cleanup: () => {
        clearTimeout(timer);
        if (signal) signal.removeEventListener('abort', onAbort);
      },
      expiresAt: createdAt + this.ttlMs
    };
    this.pending.set(id, entry);
    return { id, status: 'pending', wait };
  }

  async resolve(id: string, input: { decision: unknown }, now: () => number = Date.now): Promise<void> {
    if (input.decision !== 'approved' && input.decision !== 'rejected') {
      throw new AppError('approval_not_found');
    }
    const pending = this.pending.get(id);
    if (!pending || pending.expiresAt <= now()) throw new AppError('approval_not_found');
      this.pending.delete(id);
      pending.cleanup();
      const result = { id, status: input.decision, decision: input.decision } as ApprovalRequest;
      this.decisions.set(id, result);
      pending.resolve(result);
  }

  status(id: string, now: () => number = Date.now): ApprovalRequest | undefined {
    const decision = this.decisions.get(id);
    if (decision) return decision;
    const pending = this.pending.get(id);
    if (!pending || pending.expiresAt <= now()) {
      this.pending.delete(id);
      return undefined;
    }
    return { id, status: 'pending', decision: 'rejected' };
  }

  onModuleDestroy(): void {
    for (const pending of this.pending.values()) {
      pending.cleanup();
      pending.resolve({ id: pending.id, status: 'cancelled', decision: 'rejected' });
    }
    this.pending.clear();
    this.decisions.clear();
  }

}
