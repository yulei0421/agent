export type DeepSeekSseEvent =
  | { type: 'delta' | 'reasoning'; content: string }
  | { type: 'tool_call_delta'; index?: number; id?: string; name?: string; arguments?: string }
  | { type: 'done' }
  | { type: 'error'; message: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function getDelta(value: unknown): Record<string, unknown> | null {
  if (!isRecord(value) || !Array.isArray(value.choices)) return null;
  const choice = value.choices[0];
  return isRecord(choice) && isRecord(choice.delta) ? choice.delta : null;
}

export function parseDeepSeekSse(text: string): DeepSeekSseEvent[] {
  return text
    .split(/\r?\n\r?\n+/)
    .map((block) => block.trim())
    .filter(Boolean)
    .flatMap((block): DeepSeekSseEvent[] => {
      const payload = block
        .split(/\r?\n/)
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trim())
        .join('\n');
      if (!payload) return [];
      if (payload === '[DONE]') return [{ type: 'done' }];

      try {
        const delta = getDelta(JSON.parse(payload) as unknown);
        if (!delta) return [];
        const events: DeepSeekSseEvent[] = [];
        if (typeof delta.content === 'string' && delta.content) events.push({ type: 'delta', content: delta.content });
        else if (typeof delta.reasoning_content === 'string' && delta.reasoning_content) {
          events.push({ type: 'reasoning', content: delta.reasoning_content });
        }

        if (!Array.isArray(delta.tool_calls)) return events;
        for (const rawCall of delta.tool_calls) {
          if (!isRecord(rawCall)) continue;
          const event: Extract<DeepSeekSseEvent, { type: 'tool_call_delta' }> = { type: 'tool_call_delta' };
          if (Number.isInteger(rawCall.index)) event.index = rawCall.index as number;
          if (typeof rawCall.id === 'string') event.id = rawCall.id;
          const fn = isRecord(rawCall.function) ? rawCall.function : null;
          if (typeof fn?.name === 'string') event.name = fn.name;
          if (typeof fn?.arguments === 'string') event.arguments = fn.arguments;
          events.push(event);
        }
        return events;
      } catch {
        return [{ type: 'error', message: 'DeepSeek SSE parse failed' }];
      }
    });
}

export function formatSse(event: unknown): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

export function createDeepSeekSseParser(onEvent: (event: DeepSeekSseEvent) => void) {
  let buffer = '';
  return {
    push(chunk: string) {
      buffer += chunk;
      const parts = buffer.split(/\r?\n\r?\n/);
      buffer = parts.pop() ?? '';
      for (const event of parseDeepSeekSse(parts.join('\n\n'))) onEvent(event);
    },
    flush() {
      if (!buffer.trim()) return;
      for (const event of parseDeepSeekSse(buffer)) onEvent(event);
      buffer = '';
    }
  };
}
