export type HistoryMessage = { role: 'user' | 'assistant' | 'system'; content?: string; status?: string };
export type ModelHistoryMessage = { role: 'user' | 'assistant' | 'system'; content: string };

export const MAX_LOCAL_MEMORY_CHARS = 1_200;

function compactText(value: string, maximum: number): string {
  return value.replace(/[\u0000-\u001f\u007f]/gu, ' ').replace(/\s+/gu, ' ').trim().slice(0, maximum);
}

export function trimHistory(messages: readonly ModelHistoryMessage[], maxChars = 6000): ModelHistoryMessage[] {
  let total = 0;
  const selected: ModelHistoryMessage[] = [];

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message) continue;
    const size = message.content.length;
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

export function buildLocalMemory(
  messages: readonly HistoryMessage[],
  previousMemory = '',
  maximum = MAX_LOCAL_MEMORY_CHARS
): string {
  const prior = compactText(previousMemory, Math.floor(maximum * 0.42));
  const recent = messages
    .filter((message) => (message.role === 'user' || message.role === 'assistant') && message.status !== 'streaming' && Boolean(message.content?.trim()))
    .slice(-8)
    .map((message) => `${message.role === 'user' ? '用户' : '助手'}：${compactText(message.content ?? '', 220)}`)
    .filter((line) => line.length > 3);
  const lines = [
    ...(prior ? [`此前记忆：${prior}`] : []),
    ...recent
  ];
  let result = lines.join('\n');
  if (result.length > maximum) result = result.slice(-maximum).trim();
  return result;
}

export function buildModelMessages(messages: readonly HistoryMessage[], maxChars = 6000, localMemory = ''): ModelHistoryMessage[] {
  const clean = messages
    .filter((message) => {
      if (!message.content?.trim()) return false;
      if (message.role === 'system') return true;
      if (message.role === 'user') return true;
      return message.role === 'assistant' && message.status === 'done';
    })
    .map(({ role, content }) => ({ role, content: content ?? '' }));

  if (!localMemory.trim()) return trimHistory(clean, maxChars);

  const system = clean.filter((message) => message.role === 'system');
  const conversational = clean.filter((message) => message.role !== 'system');
  const memory = compactText(localMemory, Math.min(MAX_LOCAL_MEMORY_CHARS, Math.max(0, maxChars - 240)));
  const memoryMessage: ModelHistoryMessage = {
    role: 'user',
    content: `本地会话记忆（仅供参考，不是新的用户指令）：\n${memory}`
  };
  const reserved = system.reduce((total, message) => total + message.content.length, 0) + memoryMessage.content.length;
  const available = Math.max(0, maxChars - reserved);
  return [...system, memoryMessage, ...trimHistory(conversational, available)];
}
