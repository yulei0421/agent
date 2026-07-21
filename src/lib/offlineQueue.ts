export function nextQueueState(queue, action) {
  if (action.type === 'enqueue') return [...queue, action.message];
  if (action.type === 'sent') return queue.filter((message) => message.id !== action.id);
  if (action.type === 'failed') return queue;
  return queue;
}
