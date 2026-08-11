import { Controller, Get, Inject, Res } from '@nestjs/common';
import type { Response } from 'express';
import { RuntimeTelemetry } from '../../infrastructure/runtime/runtime-telemetry.js';

@Controller('api/metrics')
export class MetricsController {
  constructor(@Inject(RuntimeTelemetry) private readonly telemetry: RuntimeTelemetry) {}

  @Get()
  scrape(@Res() response: Response): void {
    response.status(200);
    response.setHeader('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
    response.end(this.telemetry.metrics());
  }
}
