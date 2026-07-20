export function trimHistory(messages, maxChars = 6000) {
  let total = 0;
  const selected = [];

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    const size = String(message.content ?? '').length;
    if (total + size > maxChars) break;
    selected.unshift({ role: message.role, content: message.content });
    total += size;
  }

  return selected;
}

export function normalizeInterruptedMessages(messages) {
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

export function buildModelMessages(messages, maxChars = 6000) {
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
