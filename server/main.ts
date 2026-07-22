import 'reflect-metadata';
import { json } from 'express';
import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import { AppModule } from './app.module.js';
import { parseAppConfig } from './infrastructure/config/app-config.service.js';

export async function createApp(environment: NodeJS.ProcessEnv = process.env): Promise<INestApplication> {
  const config = parseAppConfig(environment);
  const app = await NestFactory.create(AppModule, { logger: false });
  app.use(json({ limit: '1mb' }));
  app.enableCors({
    origin: config.clientUrl,
    allowedHeaders: ['Content-Type'],
    methods: ['GET', 'POST', 'OPTIONS']
  });
  if (config.trustProxy) app.getHttpAdapter().getInstance().set('trust proxy', 1);
  return app;
}

async function bootstrap(): Promise<void> {
  const app = await createApp();
  const config = parseAppConfig(process.env);
  await app.listen(config.port, '127.0.0.1');
  console.log(`DeepSeek demo server: http://127.0.0.1:${config.port}`);
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  void bootstrap();
}
