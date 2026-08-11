import type { ModelClient, ModelRequest } from '../../application/chat/chat.ports.js';
import { AppError } from '../../domain/errors/app-error.js';
import type { ModelResilienceConfig } from '../config/app-config.service.js';
import { RuntimeTelemetry, type CircuitStatus } from '../runtime/runtime-telemetry.js';
import type { DeepSeekSseEvent } from '../../sse.js';

class ModelTimeoutError extends Error {
  constructor() {
    super('Model stream timed out');
  }
}

const RETRY_CLEANUP_HANDOFF_MS = 100;

type CleanupMode = 'detach' | 'handoff';

export interface ResilientModelClientRuntime {
  now?: () => number;
  setTimeout?: (callback: () => void, delayMs: number) => unknown;
  clearTimeout?: (timer: unknown) => void;
}

interface RuntimeScheduler {
  now: () => number;
  setTimeout: (callback: () => void, delayMs: number) => unknown;
  clearTimeout: (timer: unknown) => void;
}

interface CircuitLease {
  isProbe: boolean;
  generation: number;
}

function createRuntime(runtime: ResilientModelClientRuntime | undefined): RuntimeScheduler {
  return {
    now: runtime?.now ?? Date.now,
    setTimeout: runtime?.setTimeout ?? ((callback, delayMs) => setTimeout(callback, delayMs)),
    clearTimeout: runtime?.clearTimeout ?? ((timer) => clearTimeout(timer as ReturnType<typeof setTimeout>))
  };
}

function modelUnavailable(error: unknown): AppError {
  if (error instanceof AppError && error.code === 'model_unavailable') return error;
  return new AppError('model_unavailable');
}

function requestAborted(signal: AbortSignal): AppError | null {
  return signal.aborted ? new AppError('request_aborted') : null;
}

async function closeIterator(
  iterator: AsyncIterator<unknown> | undefined,
  mode: CleanupMode,
  parentSignal: AbortSignal,
  runtime: RuntimeScheduler,
  handoffMs: number
): Promise<boolean> {
  if (!iterator?.return) return true;
  let closing: Promise<unknown>;
  try {
    closing = Promise.resolve(iterator.return());
  } catch {
    return true;
  }
  if (mode === 'detach') {
    void closing.catch(() => undefined);
    return true;
  }

  if (parentSignal.aborted) {
    void closing.catch(() => undefined);
    throw new AppError('request_aborted');
  }

  let timeout: unknown;
  let rejectAbort: ((reason: AppError) => void) | undefined;
  const parentAbort = new Promise<never>((_resolve, reject) => {
    rejectAbort = reject;
  });
  const onAbort = () => rejectAbort?.(new AppError('request_aborted'));
  parentSignal.addEventListener('abort', onAbort, { once: true });
  const handoff = mode === 'handoff'
    ? new Promise<false>((resolve) => {
      timeout = runtime.setTimeout(() => resolve(false), handoffMs);
    })
    : undefined;

  try {
    return await Promise.race([closing.then(() => true, () => true), parentAbort, ...(handoff ? [handoff] : [])]);
  } finally {
    if (timeout !== undefined) runtime.clearTimeout(timeout);
    parentSignal.removeEventListener('abort', onAbort);
    void closing.catch(() => undefined);
  }
}

async function nextWithDeadline<T>(
  iterator: AsyncIterator<T>,
  parentSignal: AbortSignal,
  childController: AbortController,
  timeoutMs: number,
  runtime: RuntimeScheduler
): Promise<IteratorResult<T>> {
  const aborted = requestAborted(parentSignal);
  if (aborted) throw aborted;

  let timeout: unknown;
  let rejectAbort: ((reason: AppError) => void) | undefined;
  const parentAbort = new Promise<never>((_resolve, reject) => {
    rejectAbort = reject;
  });
  const onAbort = () => {
    childController.abort();
    rejectAbort?.(new AppError('request_aborted'));
  };
  parentSignal.addEventListener('abort', onAbort, { once: true });
  const deadline = new Promise<never>((_resolve, reject) => {
    timeout = runtime.setTimeout(() => {
      childController.abort();
      reject(parentSignal.aborted ? new AppError('request_aborted') : new ModelTimeoutError());
    }, timeoutMs);
  });

  try {
    return await Promise.race([iterator.next(), parentAbort, deadline]);
  } finally {
    if (timeout !== undefined) runtime.clearTimeout(timeout);
    parentSignal.removeEventListener('abort', onAbort);
  }
}

export class ResilientModelClient implements ModelClient {
  private consecutiveFailures = 0;
  private circuit: CircuitStatus = 'closed';
  private openUntil = 0;
  private circuitGeneration = 0;
  private readonly runtime: RuntimeScheduler;

  constructor(
    private readonly inner: ModelClient,
    private readonly telemetry: RuntimeTelemetry,
    private readonly options: ModelResilienceConfig,
    runtime?: ResilientModelClientRuntime
  ) {
    this.runtime = createRuntime(runtime);
  }

  async *stream(request: ModelRequest, signal: AbortSignal): AsyncIterable<DeepSeekSseEvent> {
    const cancelled = requestAborted(signal);
    if (cancelled) throw cancelled;

    const lease = this.beginRequest(signal);
    const startedAt = this.runtime.now();
    const deadlineAt = startedAt + this.options.totalTimeoutMs;
    let yieldedEvent = false;
    let probeSettled = !lease.isProbe;

    try {
      for (let attempt = 0; attempt <= this.options.maxRetries; attempt += 1) {
        let iterator: AsyncIterator<DeepSeekSseEvent> | undefined;
        let firstEvent = true;
        let cleanupMode: CleanupMode = 'detach';
        let cleanupDeadlineMs = 0;
        let cleanupReleased = true;
        let completed = false;
        let retryAfterCleanup = false;
        const attemptGeneration = this.circuitGeneration;
        const attemptStartedAt = this.runtime.now();
        const childController = new AbortController();
        const onParentAbort = () => childController.abort();
        signal.addEventListener('abort', onParentAbort, { once: true });

        try {
          const aborted = requestAborted(signal);
          if (aborted) throw aborted;
          iterator = this.inner.stream(request, childController.signal)[Symbol.asyncIterator]();

          while (true) {
            const remaining = deadlineAt - this.runtime.now();
            if (remaining <= 0) {
              childController.abort();
              throw new ModelTimeoutError();
            }
            const phaseTimeout = firstEvent ? this.options.firstEventTimeoutMs : this.options.idleTimeoutMs;
            const next = await nextWithDeadline(iterator, signal, childController, Math.min(phaseTimeout, remaining), this.runtime);
            const afterNext = requestAborted(signal);
            if (afterNext) throw afterNext;
            if (next.done) {
              cleanupMode = 'handoff';
              cleanupDeadlineMs = Math.max(0, deadlineAt - this.runtime.now());
              completed = true;
              break;
            }
            firstEvent = false;
            const beforeYield = requestAborted(signal);
            if (beforeYield) throw beforeYield;
            yieldedEvent = true;
            yield next.value;
          }
        } catch (error) {
          const aborted = requestAborted(signal);
          if (aborted || (error instanceof AppError && error.code === 'request_aborted')) throw aborted ?? error;

          const timeout = error instanceof ModelTimeoutError;
          const unavailable = modelUnavailable(error);
          this.telemetry.recordModel(timeout ? 'timeout' : 'failure', this.runtime.now() - attemptStartedAt);
          const remainingCleanupMs = Math.max(0, deadlineAt - this.runtime.now());

          if (!yieldedEvent && attempt < this.options.maxRetries) {
            cleanupMode = 'handoff';
            cleanupDeadlineMs = timeout ? Math.min(RETRY_CLEANUP_HANDOFF_MS, remainingCleanupMs) : remainingCleanupMs;
            retryAfterCleanup = true;
          } else {
            this.recordFailure(lease, attemptGeneration);
            probeSettled = true;
            cleanupMode = timeout ? 'detach' : 'handoff';
            cleanupDeadlineMs = remainingCleanupMs;
            throw unavailable;
          }
        } finally {
          try {
            childController.abort();
            cleanupReleased = await closeIterator(iterator, cleanupMode, signal, this.runtime, cleanupDeadlineMs);
          } finally {
            signal.removeEventListener('abort', onParentAbort);
          }
        }

        if (retryAfterCleanup) {
          if (cleanupReleased && this.runtime.now() < deadlineAt) {
            this.telemetry.recordModel('retry');
            continue;
          }
          this.recordFailure(lease, attemptGeneration);
          probeSettled = true;
          throw new AppError('model_unavailable');
        }

        if (completed) {
          if (!cleanupReleased) {
            this.telemetry.recordModel('timeout', this.runtime.now() - attemptStartedAt);
            this.recordFailure(lease, attemptGeneration);
            probeSettled = true;
            throw new AppError('model_unavailable');
          }
          const aborted = requestAborted(signal);
          if (aborted) throw aborted;
          this.recordSuccess(lease, attemptGeneration, this.runtime.now() - attemptStartedAt);
          probeSettled = true;
          return;
        }
      }
    } catch (error) {
      const aborted = requestAborted(signal);
      if (aborted || (error instanceof AppError && error.code === 'request_aborted')) {
        throw aborted ?? error;
      }
      throw error;
    } finally {
      if (lease.isProbe && !probeSettled && lease.generation === this.circuitGeneration) this.openCircuit();
    }
  }

  private beginRequest(signal: AbortSignal): CircuitLease {
    const aborted = requestAborted(signal);
    if (aborted) throw aborted;
    if (this.circuit === 'half_open') return this.rejectCircuit();
    if (this.circuit !== 'open') return { isProbe: false, generation: this.circuitGeneration };
    if (this.runtime.now() < this.openUntil) return this.rejectCircuit();
    this.setCircuit('half_open');
    return { isProbe: true, generation: this.circuitGeneration };
  }

  private rejectCircuit(): never {
    this.telemetry.recordModel('circuit_open');
    throw new AppError('model_unavailable');
  }

  private recordSuccess(lease: CircuitLease, attemptGeneration: number, durationMs: number): void {
    this.telemetry.recordModel('success', durationMs);
    if (lease.generation !== this.circuitGeneration || attemptGeneration !== this.circuitGeneration) return;
    this.consecutiveFailures = 0;
    if (lease.isProbe || this.circuit !== 'closed') this.setCircuit('closed');
  }

  private recordFailure(lease: CircuitLease, attemptGeneration: number): void {
    if (lease.generation !== this.circuitGeneration || attemptGeneration !== this.circuitGeneration) return;
    if (lease.isProbe) {
      this.openCircuit();
      return;
    }
    this.consecutiveFailures += 1;
    if (this.consecutiveFailures >= this.options.circuitFailureThreshold) this.openCircuit();
  }

  private openCircuit(): void {
    this.circuitGeneration += 1;
    this.openUntil = this.runtime.now() + this.options.circuitCooldownMs;
    this.setCircuit('open');
    this.telemetry.recordModel('circuit_open');
  }

  private setCircuit(circuit: CircuitStatus): void {
    this.circuit = circuit;
    this.telemetry.setModelCircuit(circuit);
  }
}
