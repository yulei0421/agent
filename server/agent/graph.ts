import { END, START, StateGraph } from '@langchain/langgraph';
import type { ModelClient, Planner, ToolExecutor } from '../application/chat/chat.ports.js';
import type { ToolExecutionResult } from '../domain/tools/tool.types.js';
import { AppError } from '../domain/errors/app-error.js';
import type { DeepSeekSseEvent } from '../sse.js';
import type { AgentSseEvent } from '../types.js';
import {
  AgentStateAnnotation,
  normalizePlan,
  type AssistantToolCall,
  type AgentGraphState,
  type ModelConversationMessage,
  type PendingToolCall
} from './state.js';

const MAX_TOOL_ROUNDS = 3;
const MAX_TOOL_CALLS = 6;
const INVALID_TOOL_CALL_INSTRUCTION = 'Authoritative system instruction: the previous model tool call was invalid_tool_call. Answer directly using the existing conversation context. Do not retry or make any more tool calls.';
// A single internal cancellation result keeps every raced operation type-safe.
const ABORTED = Symbol('operation_aborted');

function publicModelError(error: unknown): Extract<AgentSseEvent, { type: 'error' }> {
  return { type: 'error', message: error instanceof AppError ? error.code : 'model_unavailable' };
}

export interface OnlineAgentDependencies {
  model: ModelClient;
  tools: ToolExecutor;
  planner?: Planner;
}

function publish(state: typeof AgentStateAnnotation.State, event: AgentSseEvent): void {
  state.onEvent?.(event);
}

function isCompleteJson(value: string): boolean {
  try {
    JSON.parse(value);
    return true;
  } catch {
    return false;
  }
}

function findUnindexedToolCall(
  calls: ReadonlyMap<string, PendingToolCall>,
  event: { id?: string; name?: string }
): [string, PendingToolCall] | undefined {
  const entries = [...calls.entries()];
  const matchingId = typeof event.id === 'string'
    ? entries.filter(([, call]) => call.id === event.id)
    : [];
  if (matchingId.length === 1) return matchingId[0];

  const matchingName = typeof event.name === 'string'
    ? entries.filter(([, call]) => call.name === event.name)
    : [];
  const namedCall = matchingName[0];
  if (
    matchingName.length === 1
    && namedCall
    && namedCall[1].hasArguments
    && !isCompleteJson(namedCall[1].arguments)
  ) return namedCall;

  // Without an index, append only when the in-progress argument stream has a
  // single plausible owner. This preserves split single-tool calls without
  // silently assigning an ambiguous fragment to a different tool invocation.
  const incomplete = entries.filter(([, call]) => call.hasArguments && !isCompleteJson(call.arguments));
  if (incomplete.length === 1) return incomplete[0];
  return undefined;
}

function mergeToolCall(calls: Map<string, PendingToolCall>, event: Extract<AgentSseEvent | { type: 'tool_call_delta'; index?: number; id?: string; name?: string; arguments?: string }, { type: 'tool_call_delta' }>, order: number): void {
  const index = typeof event.index === 'number' && Number.isInteger(event.index) && event.index >= 0
    ? event.index
    : undefined;
  const matched = index === undefined ? findUnindexedToolCall(calls, event) : undefined;
  const key = index === undefined ? (matched?.[0] ?? `missing:${order}`) : `index:${index}`;
  const existing = matched?.[1] ?? calls.get(key) ?? {
    index: index ?? Number.MAX_SAFE_INTEGER,
    order,
    arguments: '',
    hasArguments: false
  };
  if (typeof event.id === 'string') existing.id = event.id;
  if (typeof event.name === 'string') existing.name = event.name;
  if (typeof event.arguments === 'string') {
    existing.arguments += event.arguments;
    existing.hasArguments = true;
  }
  calls.set(key, existing);
}

function assistantToolCall(call: PendingToolCall): AssistantToolCall | null {
  if (!call.id || !call.name || !call.hasArguments) return null;
  return { id: call.id, type: 'function', function: { name: call.name, arguments: call.arguments } };
}

function resultEvent(id: string | undefined, name: string, result: ToolExecutionResult): AgentSseEvent {
  const { name: _resultName, ...eventResult } = result;
  return { type: 'tool_result', id, name, ...eventResult };
}

function routeAfterModel(): 'evaluate_next' {
  return 'evaluate_next';
}

function routeAfterPlan(state: typeof AgentStateAnnotation.State): 'model_agent' | 'finalize' {
  return state.finalized || state.terminated || state.signal?.aborted ? 'finalize' : 'model_agent';
}

function routeAfterPlanningOnly(state: typeof AgentStateAnnotation.State): 'finalize' | typeof END {
  return state.finalized || state.terminated || state.signal?.aborted ? 'finalize' : END;
}

function routeAfterEvaluation(state: typeof AgentStateAnnotation.State): 'execute_tools' | 'model_agent' | 'finalize' {
  if (state.finalized || state.signal?.aborted) return 'finalize';
  if (state.pendingCalls.length > 0) return 'execute_tools';
  return state.resumeModelAfterTools ? 'model_agent' : 'finalize';
}

function addInvalidToolCallInstruction(messages: typeof AgentStateAnnotation.State['messages']): void {
  if (messages.some((message) => message.role === 'system' && message.content === INVALID_TOOL_CALL_INSTRUCTION)) return;
  const firstNonSystem = messages.findIndex((message) => message.role !== 'system');
  messages.splice(firstNonSystem === -1 ? messages.length : firstNonSystem, 0, {
    role: 'system',
    content: INVALID_TOOL_CALL_INSTRUCTION
  });
}

function currentPlanInstruction(state: AgentGraphState): ModelConversationMessage | null {
  const step = state.plan[state.currentStep];
  return typeof step === 'string'
    ? {
      role: 'system',
      content: `Authoritative server planning instruction: complete the current step: ${step}. Use only registered tools when current information is required; otherwise answer the user when the goal is complete.`
    }
    : null;
}

function messagesForModel(state: AgentGraphState): ModelConversationMessage[] {
  const instruction = currentPlanInstruction(state);
  if (!instruction) return [...state.messages];
  const firstNonSystem = state.messages.findIndex((message) => message.role !== 'system');
  const index = firstNonSystem === -1 ? state.messages.length : firstNonSystem;
  return [...state.messages.slice(0, index), instruction, ...state.messages.slice(index)];
}

function nextStep(plan: readonly string[], currentStep: number): number {
  return currentStep < plan.length ? currentStep + 1 : currentStep;
}

async function planWithCancellation(
  planner: Planner | undefined,
  goal: string,
  signal: AbortSignal | undefined
): Promise<readonly string[] | typeof ABORTED> {
  if (!planner) return [];
  if (signal?.aborted) return ABORTED;

  let onAbort: (() => void) | undefined;
  const abortPromise: Promise<typeof ABORTED> = signal
    ? new Promise((resolve) => {
      onAbort = () => resolve(ABORTED);
      signal.addEventListener('abort', onAbort, { once: true });
    })
    : new Promise(() => undefined);
  const plannerPromise = Promise.resolve().then<readonly string[] | typeof ABORTED>(() => {
    if (signal?.aborted) return ABORTED;
    return planner(goal, signal);
  });
  // The planner can ignore cancellation and reject after the abort branch wins.
  // Keep an explicit rejection observer attached for that late settlement.
  void plannerPromise.catch(() => undefined);

  try {
    const plan = await Promise.race([plannerPromise, abortPromise]);
    return plan;
  } finally {
    if (onAbort) signal?.removeEventListener('abort', onAbort);
  }
}

async function waitForOperation<T>(operation: PromiseLike<T>, signal: AbortSignal | undefined): Promise<T | typeof ABORTED> {
  const pending = Promise.resolve(operation);
  if (signal?.aborted) {
    void pending.catch(() => undefined);
    return ABORTED;
  }
  if (!signal) return pending;

  let onAbort: (() => void) | undefined;
  const aborted = new Promise<typeof ABORTED>((resolve) => {
    onAbort = () => resolve(ABORTED);
    signal.addEventListener('abort', onAbort, { once: true });
  });
  try {
    const result = await Promise.race([pending, aborted]);
    if (result === ABORTED) {
      // The adapter may settle after this request has ended; consume a late rejection.
      void pending.catch(() => undefined);
    }
    return result;
  } finally {
    if (onAbort) signal.removeEventListener('abort', onAbort);
  }
}

async function closeIterator(iterator: AsyncIterator<unknown>, signal?: AbortSignal): Promise<boolean> {
  if (!iterator.return) return false;
  // Streaming adapters can own readers/sockets; never let cleanup failures alter
  // the already-determined chat result.
  try {
    const result = await waitForOperation(iterator.return(), signal);
    return result === ABORTED;
  } catch {
    // Non-conforming adapters can throw before returning a promise.
    return false;
  }
}

function closeIteratorAfterAbort(iterator: AsyncIterator<unknown>): void {
  // Cancellation must not wait for a stuck reader, but still gives adapters a
  // chance to release resources when their cleanup eventually settles.
  void closeIterator(iterator);
}

function createPlanNode(planner: Planner | undefined) {
  return async (state: typeof AgentStateAnnotation.State) => {
    if (state.signal?.aborted) return { finalized: true, terminated: true };
    try {
      const rawPlan = await planWithCancellation(planner, state.goal, state.signal);
      if (rawPlan === ABORTED || state.signal?.aborted) return { finalized: true, terminated: true };
      if (!Array.isArray(rawPlan) || rawPlan.some((step) => typeof step !== 'string')) {
        return { plan: [], currentStep: 0, terminated: false };
      }
      return { plan: normalizePlan(rawPlan), currentStep: 0, terminated: false };
    } catch {
      if (state.signal?.aborted) return { finalized: true, terminated: true };
      return { plan: [], currentStep: 0, terminated: false };
    }
  };
}

function finalizeNode(state: typeof AgentStateAnnotation.State) {
  const events: AgentSseEvent[] = state.signal?.aborted || state.events.some((event) => event.type === 'done')
    ? []
    : [{ type: 'done' }];
  for (const event of events) publish(state, event);
  return { finalized: true, terminated: Boolean(state.signal?.aborted), events };
}

export function createOnlineAgentGraph(dependencies: OnlineAgentDependencies) {
  const planNode = createPlanNode(dependencies.planner);

  const modelNode = async (state: typeof AgentStateAnnotation.State) => {
    if (state.signal?.aborted) return { finalized: true, terminated: true };
    const calls = new Map<string, PendingToolCall>();
    const events: AgentSseEvent[] = [];
    let order = 0;
    let done = false;
    let iterator: AsyncIterator<DeepSeekSseEvent> | undefined;
    let cleanupAborted = false;
    let modelError: AgentSseEvent | undefined;
    try {
      const signal = state.signal ?? new AbortController().signal;
      const stream = dependencies.model.stream({
        messages: messagesForModel(state),
        tools: state.forceFinalAnswer ? [] : dependencies.tools.definitions(),
        forceFinalAnswer: state.forceFinalAnswer
      }, signal);
      iterator = stream[Symbol.asyncIterator]();
      while (!done) {
        const next = await waitForOperation(iterator.next(), signal);
        if (next === ABORTED || state.signal?.aborted) {
          return { finalized: true, terminated: true };
        }
        if (next.done) break;
        const event = next.value;
        if (event.type === 'done') {
          done = true;
        } else if (event.type === 'delta' || event.type === 'reasoning') {
          events.push(event);
          publish(state, event);
        } else if (event.type === 'tool_call_delta') {
          mergeToolCall(calls, event, order);
        } else if (event.type === 'error') {
          modelError = publicModelError(undefined);
          break;
        }
        order += 1;
      }
    } catch (error) {
      modelError = publicModelError(error);
    } finally {
      if (iterator) {
        if (state.signal?.aborted) closeIteratorAfterAbort(iterator);
        else cleanupAborted = await closeIterator(iterator, state.signal);
      }
    }
    if (cleanupAborted || state.signal?.aborted) return { finalized: true, terminated: true };
    if (modelError) {
      publish(state, modelError);
      return { events: [modelError], finalized: true, pendingCalls: [], resumeModelAfterTools: false };
    }
    return {
      events,
      pendingCalls: [...calls.values()].sort((left, right) => left.index - right.index || left.order - right.order),
      modelToolsDisabled: state.forceFinalAnswer,
      resumeModelAfterTools: false
    };
  };

  const executeToolsNode = async (state: typeof AgentStateAnnotation.State) => {
    if (state.signal?.aborted) return { finalized: true, terminated: true };
    const events: AgentSseEvent[] = [];
    const addEvent = (event: AgentSseEvent) => {
      events.push(event);
      publish(state, event);
    };
    const messages = [...state.messages];
    const assistantCalls = state.pendingCalls.map(assistantToolCall).filter((call): call is AssistantToolCall => call !== null);
    if (assistantCalls.length > 0) messages.push({ role: 'assistant', tool_calls: assistantCalls });

    if (state.modelToolsDisabled) {
      for (const call of state.pendingCalls) {
        const complete = assistantToolCall(call);
        if (!complete) {
          addEvent({ type: 'tool_result', name: 'invalid_tool_call', ok: false, errorCode: 'invalid_tool_call' });
          continue;
        }
        addEvent({ type: 'tool', id: complete.id, name: complete.function.name });
        addEvent({ type: 'tool_result', id: complete.id, name: complete.function.name, ok: false, errorCode: 'tool_limit_reached' });
      }
      addEvent({ type: 'error', message: 'Model returned tool calls after tools were disabled' });
      return { events, messages, finalized: true, pendingCalls: [], resumeModelAfterTools: false };
    }

    let toolCalls = state.toolCalls;
    let forceFinalAnswer = state.forceFinalAnswer;
    let hasInvalidToolCall = false;
    for (const call of state.pendingCalls) {
      if (state.signal?.aborted) return { finalized: true, terminated: true };
      const complete = assistantToolCall(call);
      if (!complete) {
        addEvent({ type: 'tool_result', name: 'invalid_tool_call', ok: false, errorCode: 'invalid_tool_call' });
        forceFinalAnswer = true;
        hasInvalidToolCall = true;
        continue;
      }
      addEvent({ type: 'tool', id: complete.id, name: complete.function.name });
      let result: ToolExecutionResult;
      if (toolCalls >= MAX_TOOL_CALLS) {
        result = { ok: false, name: complete.function.name, errorCode: 'tool_limit_reached' };
        forceFinalAnswer = true;
      } else {
        toolCalls += 1;
        try {
          const execution = Promise.resolve().then(() => {
            // Keep this promise's result type limited to tool results. Cancellation
            // is represented exclusively by waitForOperation's racing branch.
            if (state.signal?.aborted) throw new Error('Tool execution aborted');
            return dependencies.tools.execute(
              { id: complete.id, name: complete.function.name, arguments: complete.function.arguments },
              { ip: state.ip, now: state.now, signal: state.signal }
            );
          });
          const outcome = await waitForOperation(execution, state.signal);
          if (outcome === ABORTED || state.signal?.aborted) {
            return { finalized: true, terminated: true };
          }
          result = outcome;
        } catch {
          result = { ok: false, name: complete.function.name, errorCode: 'tool_execution_failed' };
        }
      }
      if (state.signal?.aborted) return { finalized: true, terminated: true };
      addEvent(resultEvent(complete.id, complete.function.name, result));
      messages.push({ role: 'tool', tool_call_id: complete.id, content: JSON.stringify(result) });
    }
    if (hasInvalidToolCall) addInvalidToolCallInstruction(messages);
    const toolRounds = state.toolRounds + 1;
    const currentStep = nextStep(state.plan, state.currentStep);
    const planComplete = state.plan.length > 0 && currentStep >= state.plan.length;
    return {
      events,
      messages,
      pendingCalls: [],
      toolCalls,
      toolRounds,
      currentStep,
      forceFinalAnswer: forceFinalAnswer || planComplete || toolRounds >= MAX_TOOL_ROUNDS || toolCalls >= MAX_TOOL_CALLS,
      resumeModelAfterTools: true
    };
  };

  const evaluateNode = (state: typeof AgentStateAnnotation.State) => ({
    forceFinalAnswer: state.forceFinalAnswer || state.toolRounds >= MAX_TOOL_ROUNDS || state.toolCalls >= MAX_TOOL_CALLS
  });

  return new StateGraph(AgentStateAnnotation)
    .addNode('plan_request', planNode)
    .addNode('model_agent', modelNode)
    .addNode('execute_tools', executeToolsNode)
    .addNode('evaluate_next', evaluateNode)
    .addNode('finalize', finalizeNode)
    .addEdge(START, 'plan_request')
    .addConditionalEdges('plan_request', routeAfterPlan)
    .addConditionalEdges('model_agent', routeAfterModel)
    .addEdge('execute_tools', 'evaluate_next')
    .addConditionalEdges('evaluate_next', routeAfterEvaluation)
    .addEdge('finalize', END)
    .compile();
}

export function createPlanningGraph(planner: Planner) {
  const planNode = createPlanNode(planner);

  return new StateGraph(AgentStateAnnotation)
    .addNode('plan_request', planNode)
    .addNode('finalize', finalizeNode)
    .addEdge(START, 'plan_request')
    .addConditionalEdges('plan_request', routeAfterPlanningOnly)
    .addEdge('finalize', END)
    .compile();
}
