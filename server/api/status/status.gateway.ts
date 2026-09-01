import { randomUUID } from 'node:crypto';
import { Inject, OnModuleDestroy } from '@nestjs/common';
import { SubscribeMessage, WebSocketGateway } from '@nestjs/websockets';
import type WebSocket from 'ws';
import type { IncomingMessage } from 'node:http';
import { AppLoggerService } from '../../infrastructure/logging/app-logger.service.js';
import { AppConfigService } from '../../infrastructure/config/app-config.service.js';
import { DESKTOP_SESSION_HEADER, matchesDesktopSessionToken } from '../desktop-session.middleware.js';

type StatusClient = WebSocket & { OPEN: number };

@WebSocketGateway({ path: '/ws' })
export class StatusGateway implements OnModuleDestroy {
  private heartbeat: NodeJS.Timeout | undefined;
  private readonly clients = new Set<StatusClient>();
  private readonly connectionIds = new Map<StatusClient, string>();

  constructor(
    @Inject(AppLoggerService) private readonly logger: AppLoggerService,
    @Inject(AppConfigService) private readonly config: AppConfigService
  ) {}

  handleConnection(client: StatusClient, request?: IncomingMessage): void {
    const expectedToken = this.config.value.desktopSessionToken;
    const header = request?.headers[DESKTOP_SESSION_HEADER];
    const token = Array.isArray(header) ? undefined : header;
    if (expectedToken && !matchesDesktopSessionToken(token, expectedToken)) {
      client.close(1008, 'desktop_session_required');
      return;
    }
    const connectionId = randomUUID();
    this.clients.add(client);
    this.connectionIds.set(client, connectionId);
    this.logger.info({ event: 'ws_connected', connectionId });
    client.send(JSON.stringify({ type: 'status', status: 'connected', at: Date.now() }));
    this.startHeartbeat();
  }

  handleDisconnect(client: StatusClient): void {
    this.clients.delete(client);
    const connectionId = this.connectionIds.get(client);
    this.connectionIds.delete(client);
    this.logger.info({ event: 'ws_disconnected', connectionId });
  }

  @SubscribeMessage('ping')
  pong(): { type: 'pong'; at: number } {
    return { type: 'pong', at: Date.now() };
  }

  onModuleDestroy(): void {
    if (this.heartbeat) clearInterval(this.heartbeat);
  }

  private startHeartbeat(): void {
    if (this.heartbeat) return;
    this.heartbeat = setInterval(() => {
      const payload = JSON.stringify({ type: 'notice', message: 'server heartbeat', at: Date.now() });
      for (const client of this.clients) {
        if (client.readyState === client.OPEN) client.send(payload);
      }
    }, 15_000);
    this.heartbeat.unref();
  }
}
