export async function streamChat(messages, signal, handlers) {
  const response = await fetch('/api/chat/stream', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages }),
    signal
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: response.statusText }));
    throw new Error(error.error || `请求失败：${response.status}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split('\n\n');
    buffer = parts.pop() ?? '';

    for (const part of parts) {
      const line = part.split('\n').find((item) => item.startsWith('data:'));
      if (!line) continue;
      const event = JSON.parse(line.slice(5));
      if (event.type === 'tool') handlers.onTool?.(event);
      if (event.type === 'tool_result') handlers.onToolResult?.(event);
      if (event.type === 'reasoning') handlers.onReasoning?.(event.content);
      if (event.type === 'delta') handlers.onDelta(event.content);
      if (event.type === 'error') throw new Error(event.message);
      if (event.type === 'done') handlers.onDone?.();
    }
  }
}
