import { createDeepSeekSseParser, formatSse } from './sse.js';

const KEY_PLACEHOLDER = '在这里填写你的apikey';
const MAX_TOOL_ROUNDS = 3;
const MAX_TOOL_CALLS = 6;

export function createChatRequestBody(model, messages, tools = []) {
  return {
    model,
    messages,
    tools: Array.isArray(tools) ? tools : [],
    tool_choice: 'auto',
    stream: true,
    thinking: { type: 'disabled' }
  };
}

export function shouldStopStreaming(res) {
  return Boolean(res.destroyed || res.writableEnded);
}

function getClientIp(req) {
  if (typeof req.ip === 'string') return req.ip;
  if (typeof req.socket?.remoteAddress === 'string') return req.socket.remoteAddress;
  return '';
}

function mergeToolCall(calls, event, sequence) {
  const hasIndex = Number.isInteger(event.index) && event.index >= 0;
  const key = hasIndex ? `index:${event.index}` : `missing:${sequence}`;
  const existing = calls.get(key) ?? {
    index: hasIndex ? event.index : Number.MAX_SAFE_INTEGER,
    order: sequence,
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

function collectedToolCalls(events) {
  const calls = new Map();
  let sequence = 0;
  for (const event of events) {
    if (event.type === 'tool_call_delta') mergeToolCall(calls, event, sequence);
    sequence += 1;
  }
  return [...calls.values()]
    .sort((left, right) => left.index - right.index || left.order - right.order)
    .map(({ id, name, arguments: argumentsText, hasArguments, order }) => ({
      id,
      name,
      arguments: argumentsText,
      hasArguments,
      order
    }));
}

function isCompleteToolCall(call) {
  return typeof call.id === 'string'
    && call.id.length > 0
    && typeof call.name === 'string'
    && call.name.length > 0
    && call.hasArguments;
}

function invalidToolCall() {
  return {
    result: { ok: false, errorCode: 'invalid_tool_call' },
    executable: false,
    name: 'invalid_tool_call'
  };
}

function normalizeToolCall(call) {
  if (!isCompleteToolCall(call)) return invalidToolCall();
  const normalized = { id: call.id, name: call.name, arguments: call.arguments };
  return {
    call: normalized,
    assistantCall: {
      id: normalized.id,
      type: 'function',
      function: { name: normalized.name, arguments: normalized.arguments }
    },
    executable: true
  };
}

function fallbackRegistry() {
  return {
    definitions: () => [],
    async execute(call) {
      return { ok: false, name: call.name, errorCode: 'tool_unavailable' };
    }
  };
}

async function requestCompletion(baseUrl, apiKey, model, messages, tools, res, clientSignal, onEvent) {
  const controller = new AbortController();
  const abortWhenStopped = () => {
    if (shouldStopStreaming(res)) controller.abort();
  };
  const abortOnClose = () => controller.abort();
  const abortForClient = () => controller.abort();
  const removeCloseListener = () => {
    if (typeof res?.off === 'function') res.off('close', abortOnClose);
    else if (typeof res?.removeListener === 'function') res.removeListener('close', abortOnClose);
    clientSignal?.removeEventListener('abort', abortForClient);
  };

  if (typeof res?.once === 'function') res.once('close', abortOnClose);
  clientSignal?.addEventListener('abort', abortForClient, { once: true });
  abortWhenStopped();
  if (clientSignal?.aborted) controller.abort();

  try {
    const upstream = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(createChatRequestBody(model, messages, tools)),
      signal: controller.signal
    });

    if (!upstream.ok || !upstream.body) {
      const detail = await upstream.text();
      return { error: { status: upstream.status, detail: detail.slice(0, 300) } };
    }

    const events = [];
    const decoder = new TextDecoder();
    let upstreamDone = false;
    const parser = createDeepSeekSseParser((event) => {
      if (upstreamDone) return;
      if (event.type === 'done') upstreamDone = true;
      events.push(event);
      if (!shouldStopStreaming(res)) onEvent?.(event);
    });
    for await (const chunk of upstream.body) {
      abortWhenStopped();
      if (controller.signal.aborted) return { aborted: true };
      parser.push(decoder.decode(chunk, { stream: true }));
      if (upstreamDone) break;
    }
    abortWhenStopped();
    if (controller.signal.aborted) return { aborted: true };
    parser.flush();
    return { events, toolCalls: collectedToolCalls(events) };
  } catch (error) {
    if (controller.signal.aborted || shouldStopStreaming(res)) return { aborted: true };
    throw error;
  } finally {
    removeCloseListener();
  }
}

function writeFinalEvents(res, events) {
  let upstreamDone = false;
  for (const event of events) {
    if (event.type === 'error') {
      res.write(formatSse(event));
    }
    if (event.type === 'done') {
      if (!upstreamDone) {
        upstreamDone = true;
        res.write(formatSse({ type: 'done' }));
      }
    }
  }
  if (!upstreamDone) res.write(formatSse({ type: 'done' }));
}

export async function streamDeepSeek(req, res, {
  toolRegistry = fallbackRegistry(),
  now = () => new Date()
} = {}) {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey || apiKey === KEY_PLACEHOLDER) {
    res.status(400).json({ error: '请先在 .env 中填写 DEEPSEEK_API_KEY' });
    return;
  }

  const baseUrl = process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com';
  const model = process.env.DEEPSEEK_MODEL || 'deepseek-v4-flash';
  const tools = typeof toolRegistry?.definitions === 'function' ? toolRegistry.definitions() : [];
  const requestMessages = Array.isArray(req.body?.messages) ? [...req.body.messages] : [];
  const serverNow = now();
  const stableNow = () => serverNow;
  const clientIp = getClientIp(req);
  const clientAbortController = new AbortController();
  const abortClient = () => clientAbortController.abort();
  const removeClientCloseListener = () => {
    if (typeof res?.off === 'function') res.off('close', abortClient);
    else if (typeof res?.removeListener === 'function') res.removeListener('close', abortClient);
  };
  if (typeof res?.once === 'function') res.once('close', abortClient);
  if (shouldStopStreaming(res)) abortClient();
  let completedCalls = 0;
  let toolRounds = 0;
  let forceFinalAnswer = false;

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive'
  });

  try {
    while (!shouldStopStreaming(res)) {
      const toolsDisabledForRequest = forceFinalAnswer;
      const completion = await requestCompletion(
        baseUrl,
        apiKey,
        model,
        requestMessages,
        toolsDisabledForRequest ? [] : tools,
        res,
        clientAbortController.signal,
        (event) => {
          if (event.type === 'delta' || event.type === 'reasoning') res.write(formatSse(event));
        }
      );
      if (completion.aborted || clientAbortController.signal.aborted || shouldStopStreaming(res)) return;
      if (completion.error) {
        res.write(formatSse({
          type: 'error',
          message: `DeepSeek 请求失败：${completion.error.status}`,
          detail: completion.error.detail
        }));
        res.end();
        return;
      }

      if (completion.toolCalls.length === 0) {
        writeFinalEvents(res, completion.events);
        res.end();
        return;
      }

      const calls = completion.toolCalls.map(normalizeToolCall);
      if (toolsDisabledForRequest) {
        for (const entry of calls) {
          if (entry.executable) {
            res.write(formatSse({ type: 'tool', id: entry.call.id, name: entry.call.name }));
            res.write(formatSse({
              type: 'tool_result',
              id: entry.call.id,
              name: entry.call.name,
              ok: false,
              errorCode: 'tool_limit_reached'
            }));
          } else {
            res.write(formatSse({ type: 'tool_result', name: entry.name, ...entry.result }));
          }
        }
        res.write(formatSse({ type: 'error', message: 'DeepSeek returned tool calls after tools were disabled' }));
        res.write(formatSse({ type: 'done' }));
        res.end();
        return;
      }

      toolRounds += 1;
      const validCalls = calls.filter((call) => call.executable);
      const invalidCalls = calls.filter((call) => !call.executable);
      if (validCalls.length > 0) {
        requestMessages.push({
          role: 'assistant',
          tool_calls: validCalls.map((call) => call.assistantCall)
        });
      }

      for (const entry of calls) {
        if (!entry.executable) {
          res.write(formatSse({ type: 'tool_result', name: entry.name, ...entry.result }));
          continue;
        }
        if (clientAbortController.signal.aborted || shouldStopStreaming(res)) return;
        let result = entry.result;
        const limitReached = completedCalls >= MAX_TOOL_CALLS;
        if (!limitReached) completedCalls += 1;

        if (entry.executable && !limitReached) {
          res.write(formatSse({ type: 'tool', id: entry.call.id, name: entry.call.name }));
          try {
            result = await toolRegistry.execute(entry.call, {
              ip: clientIp,
              now: stableNow,
              signal: clientAbortController.signal
            });
          } catch {
            result = { ok: false, name: entry.call.name, errorCode: 'tool_execution_failed' };
          }
          if (clientAbortController.signal.aborted || shouldStopStreaming(res)) return;
        } else if (limitReached) {
          result = { ok: false, errorCode: 'tool_limit_reached' };
          forceFinalAnswer = true;
          res.write(formatSse({ type: 'tool', id: entry.call.id, name: entry.call.name }));
        } else {
          res.write(formatSse({ type: 'tool', id: entry.call.id, name: entry.call.name }));
        }

        res.write(formatSse({ type: 'tool_result', id: entry.call.id, name: entry.call.name, ...result }));
        requestMessages.push({
          role: 'tool',
          tool_call_id: entry.call.id,
          content: JSON.stringify(result)
        });
      }

      if (invalidCalls.length > 0) {
        requestMessages.push({
          role: 'system',
          content: '工具调用格式无效（invalid_tool_call）。请基于已有上下文直接回答，不要重试工具调用。'
        });
        forceFinalAnswer = true;
      }
      if (toolRounds >= MAX_TOOL_ROUNDS || completedCalls >= MAX_TOOL_CALLS) forceFinalAnswer = true;
    }
  } catch (error) {
    if (clientAbortController.signal.aborted || shouldStopStreaming(res)) return;
    res.write(formatSse({ type: 'error', message: error.message }));
    res.end();
  } finally {
    removeClientCloseListener();
  }
}
