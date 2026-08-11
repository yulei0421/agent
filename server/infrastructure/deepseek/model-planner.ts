import type { ModelClient } from '../../application/chat/chat.ports.js';
import { AppError } from '../../domain/errors/app-error.js';

const PLANNER_POLICY = 'You are a server-side planner. Return only a JSON object with a "steps" array of up to three concise strings. Do not call tools or include markdown.';

export function isStepObject(value: unknown): value is { steps: unknown[] } {
  return Boolean(value)
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.prototype.hasOwnProperty.call(value, 'steps')
    && Array.isArray((value as { steps?: unknown }).steps);
}

export class ModelPlanner {
  constructor(private readonly model: ModelClient) {}

  async plan(goal: string, signal?: AbortSignal): Promise<readonly string[]> {
    const activeSignal = signal ?? new AbortController().signal;
    if (activeSignal.aborted) throw new AppError('request_aborted');

    let content = '';
    try {
      for await (const event of this.model.stream({
        messages: [
          { role: 'system', content: PLANNER_POLICY },
          { role: 'user', content: goal }
        ],
        tools: [],
        responseFormat: { type: 'json_object' }
      }, activeSignal)) {
        if (activeSignal.aborted) throw new AppError('request_aborted');
        if (event.type === 'delta') content += event.content;
      }

      if (activeSignal.aborted) throw new AppError('request_aborted');
      const parsed: unknown = JSON.parse(content);
      if (!isStepObject(parsed)) return [];
      return parsed.steps.filter((step): step is string => typeof step === 'string');
    } catch (error) {
      if (error instanceof AppError && error.code === 'request_aborted') throw error;
      if (activeSignal.aborted) throw new AppError('request_aborted');
      return [];
    }
  }
}
