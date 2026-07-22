export type ClientChatMessage = { role: 'user' | 'assistant'; content: string };

export const MAX_CLIENT_MESSAGE_CONTENT_LENGTH = 6000;

export function filterClientMessages(messages: unknown): ClientChatMessage[] {
  if (!Array.isArray(messages)) return [];
  return messages.flatMap((message) => {
    if (
      !message
      || typeof message !== 'object'
      || !('role' in message)
      || !('content' in message)
      || (message.role !== 'user' && message.role !== 'assistant')
      || typeof message.content !== 'string'
      || message.content.trim().length === 0
      || message.content.length > MAX_CLIENT_MESSAGE_CONTENT_LENGTH
    ) return [];
    return [{ role: message.role, content: message.content }];
  });
}
