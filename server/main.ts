import 'reflect-metadata';
import type { Server } from 'node:http';
import { json } from 'express';
import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import { AppModule } from './app.module.js';
import { parseAppConfig } from './infrastructure/config/app-config.service.js';
import { attachWebSocket } from './websocket.js';

export async function createApp(environment: NodeJS.ProcessEnv = process.env): Promise<INestApplication> {
  const config = parseAppConfig(environment);
  const app = await NestFactory.create(AppModule.forRoot(environment), { logger: false });
  app.use(json({ limit: '1mb' }));
  app.enableCors({
    origin: config.clientUrl,
    allowedHeaders: ['Content-Type'],
    methods: ['GET', 'POST', 'OPTIONS']
  });
  if (config.trustProxy) app.getHttpAdapter().getInstance().set('trust proxy', 1);
  return app;
}

export async function bootstrap(): Promise<void> {
  const app = await createApp();
  const config = parseAppConfig(process.env);
  const socketAttachment = attachWebSocket(app.getHttpServer() as Server);
  app.enableShutdownHooks();
  app.getHttpServer().once('close', () => {
    void socketAttachment.close().catch(() => undefined);
  });
  await app.listen(config.port, '127.0.0.1');
  console.log(`DeepSeek demo server: http://127.0.0.1:${config.port}`);
}
