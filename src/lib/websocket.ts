import type { WebSocketStatus } from '../types.js';

export type StatusSocketEvent =
  | { type: 'status'; status: WebSocketStatus }
  | { type: 'notice'; message: string };

function parseEvent(value: unknown): StatusSocketEvent | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const event = value as Record<string, unknown>;
  if (event.type === 'status' && typeof event.status === 'string' && ['connecting', 'connected', 'reconnecting', 'error'].includes(event.status)) {
    return { type: 'status', status: event.status as WebSocketStatus };
  }
  return event.type === 'notice' && typeof event.message === 'string' ? { type: 'notice', message: event.message } : undefined;
}

export function connectStatusSocket(onEvent: (event: StatusSocketEvent) => void): () => void {
  let socket: WebSocket | undefined;
  let closed = false;
  let pingTimer: number | undefined;

  const clearPing = () => {
    if (pingTimer !== undefined) window.clearInterval(pingTimer);
    pingTimer = undefined;
  };
  const open = () => {
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    socket = new WebSocket(`${protocol}//${location.host}/ws`);
    onEvent({ type: 'status', status: 'connecting' });

    socket.onopen = () => {
      onEvent({ type: 'status', status: 'connected' });
      pingTimer = window.setInterval(() => socket?.send(JSON.stringify({ type: 'ping' })), 5000);
    };
    socket.onmessage = (event) => {
      try {
        const parsed = parseEvent(JSON.parse(String(event.data)) as unknown);
        if (parsed) onEvent(parsed);
      } catch {
        // Ignore malformed server status frames and keep the socket usable.
      }
    };
    socket.onclose = () => {
      clearPing();
      onEvent({ type: 'status', status: 'reconnecting' });
      if (!closed) window.setTimeout(open, 1200);
    };
    socket.onerror = () => onEvent({ type: 'status', status: 'error' });
  };

  open();
  return () => {
    closed = true;
    clearPing();
    socket?.close();
  };
}
