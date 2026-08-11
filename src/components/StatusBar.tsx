import type { WebSocketStatus } from '../types.js';

export function StatusBar({ wsStatus, notice, error, online }: { wsStatus: WebSocketStatus; notice: string; error: string; online: boolean }) {
  return (
    <header className="status-bar">
      <span className={`dot ${online ? 'ok' : 'bad'}`} />
      <span>{online ? 'online' : 'offline'}</span>
      <span>WebSocket: {wsStatus}</span>
      {notice ? <span>{notice}</span> : null}
      {error ? <strong>{error}</strong> : null}
    </header>
  );
}
