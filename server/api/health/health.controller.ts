import { Controller, Get, HttpStatus, Inject, Res } from '@nestjs/common';
import type { Response } from 'express';
import { AppConfigService } from '../../infrastructure/config/app-config.service.js';
import { RuntimeTelemetry } from '../../infrastructure/runtime/runtime-telemetry.js';

@Controller('api')
export class HealthController {
  constructor(
    @Inject(RuntimeTelemetry) private readonly telemetry: RuntimeTelemetry,
    @Inject(AppConfigService) private readonly config: AppConfigService
  ) {}

  @Get('health')
  check(): { status: 'ok' } {
    return { status: 'ok' };
  }

  @Get('ready')
  ready(@Res({ passthrough: true }) response: Response): { status: 'ready'; model: 'ready' } | { status: 'not_ready'; model: 'not_configured' | 'circuit_open' } {
    if (!this.config.value.deepSeekApiKey) {
      response.status(HttpStatus.SERVICE_UNAVAILABLE);
      return { status: 'not_ready', model: 'not_configured' };
    }
    const { circuit } = this.telemetry.modelStatus();
    if (circuit !== 'closed') {
      response.status(HttpStatus.SERVICE_UNAVAILABLE);
      return { status: 'not_ready', model: 'circuit_open' };
    }
    return { status: 'ready', model: 'ready' };
  }
}
