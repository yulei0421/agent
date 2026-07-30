export type QueueItem = { id: string; [key: string]: unknown };
export type QueueAction<T extends QueueItem> =
  | { type: 'enqueue'; message: T }
  | { type: 'sent' | 'failed'; id: string };

export function nextQueueState<T extends QueueItem>(queue: readonly T[], action: QueueAction<T>): T[] {
  if (action.type === 'enqueue') return [...queue, action.message];
  if (action.type === 'sent') return queue.filter((message) => message.id !== action.id);
  if (action.type === 'failed') return [...queue];
  return [...queue];
}
