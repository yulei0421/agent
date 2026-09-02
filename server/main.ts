import 'reflect-metadata';
import { json, static as serveStatic } from 'express';
import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import { WsAdapter } from '@nestjs/platform-ws';
import { AppModule } from './app.module.js';
import { parseAppConfig } from './infrastructure/config/app-config.service.js';
import { createDesktopSessionGuard } from './api/desktop-session.middleware.js';

export async function createApp(environment: NodeJS.ProcessEnv = process.env): Promise<INestApplication> {
  const config = parseAppConfig(environment);
  const app = await NestFactory.create(AppModule.forRoot(environment), {
    logger: false,
    abortOnError: false
  });
  app.useWebSocketAdapter(new WsAdapter(app, {
    messageParser(data) {
      try {
        const message: unknown = JSON.parse(data.toString());
        if (!message || typeof message !== 'object' || Array.isArray(message)) return undefined;
        const type = (message as { type?: unknown }).type;
        return typeof type === 'string' ? { event: type, data: message } : undefined;
      } catch {
        return undefined;
      }
    }
  }));
  // Base64 expands an 8 MB binary upload to roughly 11 MB in JSON.
  app.use(json({ limit: '12mb' }));
  app.enableCors({
    origin: config.clientUrl,
    allowedHeaders: ['Content-Type'],
    methods: ['GET', 'POST', 'OPTIONS']
  });
  if (config.desktopSessionToken) app.use('/api', createDesktopSessionGuard(config.desktopSessionToken));
  if (config.staticRendererDir) app.use(serveStatic(config.staticRendererDir, { index: 'index.html', fallthrough: true }));
  if (config.trustProxy) app.getHttpAdapter().getInstance().set('trust proxy', 1);
  return app;
}

export async function bootstrap(): Promise<void> {
  const app = await createApp();
  const config = parseAppConfig(process.env);
  app.enableShutdownHooks();
  await app.listen(config.port, '127.0.0.1');
  console.log(`DeepSeek demo server: http://127.0.0.1:${config.port}`);
}
