export function parseDeepSeekSse(text) {
  return text
    .split(/\r?\n\r?\n+/)
    .map((block) => block.trim())
    .filter(Boolean)
    .flatMap((block) => {
      const payload = block
        .split(/\r?\n/)
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trim())
        .join('\n');
      if (!payload) return [];
      if (payload === '[DONE]') return [{ type: 'done' }];

      try {
        const json = JSON.parse(payload);
        const delta = json.choices?.[0]?.delta;
        const content = delta?.content;
        const reasoning = delta?.reasoning_content;
        const events = [];

        if (content) events.push({ type: 'delta', content });
        else if (reasoning) events.push({ type: 'reasoning', content: reasoning });

        for (const toolCall of delta?.tool_calls ?? []) {
          const event = { type: 'tool_call_delta', index: toolCall.index };
          if (toolCall.id !== undefined) event.id = toolCall.id;
          if (toolCall.function?.name !== undefined) event.name = toolCall.function.name;
          if (toolCall.function?.arguments !== undefined) {
            event.arguments = toolCall.function.arguments;
          }
          events.push(event);
        }

        return events;
      } catch {
        return [{ type: 'error', message: 'DeepSeek SSE parse failed' }];
      }
    });
}

export function formatSse(event) {
  return `data: ${JSON.stringify(event)}\n\n`;
}

export function createDeepSeekSseParser(onEvent) {
  let buffer = '';

  return {
    push(chunk) {
      buffer += chunk;
      const parts = buffer.split(/\r?\n\r?\n/);
      buffer = parts.pop() ?? '';
      for (const event of parseDeepSeekSse(parts.join('\n\n'))) {
        onEvent(event);
      }
    },
    flush() {
      if (!buffer.trim()) return;
      for (const event of parseDeepSeekSse(buffer)) {
        onEvent(event);
      }
      buffer = '';
    }
  };
}
