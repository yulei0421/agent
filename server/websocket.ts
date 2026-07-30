import type { Server } from 'node:http';
import { WebSocketServer } from 'ws';

export interface WebSocketAttachment {
  close(): Promise<void>;
}

export function attachWebSocket(server: Server): WebSocketAttachment {
  const wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (socket) => {
    socket.send(JSON.stringify({ type: 'status', status: 'connected', at: Date.now() }));

    socket.on('message', (raw) => {
      let message;
      try {
        message = JSON.parse(raw.toString());
      } catch {
        socket.send(JSON.stringify({ type: 'error', message: 'Invalid WebSocket JSON' }));
        return;
      }

      if (message.type === 'ping') {
        socket.send(JSON.stringify({ type: 'pong', at: Date.now() }));
      }
    });
  });

  const heartbeat = setInterval(() => {
    const payload = JSON.stringify({ type: 'notice', message: 'server heartbeat', at: Date.now() });
    for (const client of wss.clients) {
      if (client.readyState === client.OPEN) client.send(payload);
    }
  }, 15000).unref();

  return {
    close: async () => {
      clearInterval(heartbeat);
      await new Promise<void>((resolve, reject) => wss.close((error) => error ? reject(error) : resolve()));
    }
  };
}
