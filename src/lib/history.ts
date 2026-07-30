export type HistoryMessage = { role: string; content?: string; status?: string; [key: string]: unknown };
export type ModelHistoryMessage = { role: string; content?: string };

export function trimHistory(messages: readonly ModelHistoryMessage[], maxChars = 6000): ModelHistoryMessage[] {
  let total = 0;
  const selected: ModelHistoryMessage[] = [];

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message) continue;
    const size = String(message.content ?? '').length;
    if (total + size > maxChars) break;
    selected.unshift({ role: message.role, content: message.content });
    total += size;
  }

  return selected;
}

export function normalizeInterruptedMessages<T extends HistoryMessage>(messages: readonly T[]): T[] {
  return messages.map((message) => {
    if (message.role === 'assistant' && message.status === 'streaming') {
      return {
        ...message,
        status: 'stopped',
        content: message.content || '上次生成被中断。'
      };
    }
    return message;
  });
}

export function buildModelMessages(messages: readonly HistoryMessage[], maxChars = 6000): ModelHistoryMessage[] {
  const clean = messages
    .filter((message) => {
      if (!message.content?.trim()) return false;
      if (message.role === 'system') return true;
      if (message.role === 'user') return true;
      return message.role === 'assistant' && message.status === 'done';
    })
    .map(({ role, content }) => ({ role, content }));

  return trimHistory(clean, maxChars);
}
