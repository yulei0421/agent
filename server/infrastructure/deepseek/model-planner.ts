import type { ModelClient } from '../../application/chat/chat.ports.js';
import { AppError } from '../../domain/errors/app-error.js';
import type { DynamicSubAgentPlanItem } from '../../agent/research-coordinator.js';

const PLANNER_POLICY = 'You are a server-side planner. Return only a JSON object with a "steps" array of up to three concise strings. Do not call tools or include markdown.';
const SUB_AGENT_POLICY = 'You are a server-side delegation planner. Return only JSON {"agents":[{"role":"researcher"|"risk_reviewer","goal":"...","maxItems":1-4,"timeoutMs":100-15000}]}. Choose zero to four agents. No facts, URLs, or markdown.';

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
        taskType: 'reasoning',
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

  async planSubAgents(goal: string, signal?: AbortSignal): Promise<readonly DynamicSubAgentPlanItem[]> {
    const activeSignal = signal ?? new AbortController().signal;
    if (activeSignal.aborted) throw new AppError('request_aborted');
    let content = '';
    try {
      for await (const event of this.model.stream({
        messages: [{ role: 'system', content: SUB_AGENT_POLICY }, { role: 'user', content: goal }],
        tools: [],
        taskType: 'reasoning',
        forceFinalAnswer: true,
        responseFormat: { type: 'json_object' }
      }, activeSignal)) {
        if (activeSignal.aborted) throw new AppError('request_aborted');
        if (event.type === 'delta') content += event.content;
      }
      const parsed: unknown = JSON.parse(content);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || !Array.isArray((parsed as { agents?: unknown }).agents)) return [];
      return (parsed as { agents: unknown[] }).agents.flatMap((item): DynamicSubAgentPlanItem[] => {
        if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
        const value = item as Record<string, unknown>;
        if ((value.role !== 'researcher' && value.role !== 'risk_reviewer') || typeof value.goal !== 'string') return [];
        const boundedGoal = value.goal.trim().slice(0, 240);
        if (!boundedGoal) return [];
        return [{
          role: value.role,
          goal: boundedGoal,
          ...(typeof value.maxItems === 'number' ? { maxItems: Math.min(4, Math.max(1, Math.floor(value.maxItems))) } : {}),
          ...(typeof value.timeoutMs === 'number' ? { timeoutMs: Math.min(15_000, Math.max(100, Math.floor(value.timeoutMs))) } : {}),
          ...(Array.isArray(value.dependsOn) ? { dependsOn: value.dependsOn.filter((dependency): dependency is number => Number.isInteger(dependency) && dependency >= 0).slice(0, 4) } : {})
        }];
      }).slice(0, 4);
    } catch (error) {
      if (error instanceof AppError && error.code === 'request_aborted') throw error;
      if (activeSignal.aborted) throw new AppError('request_aborted');
      return [];
    }
  }
}
