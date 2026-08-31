import { Body, Controller, Get, Inject, Param, Post, Req, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ResearchExportService } from '../../application/export/research-export.service.js';
import { AppError, toPublicError } from '../../domain/errors/app-error.js';
import { AppLoggerService } from '../../infrastructure/logging/app-logger.service.js';
import { InMemoryResearchDownloadStore } from '../../infrastructure/export/research-download.store.js';
import type { RequestWithId } from '../request-id.middleware.js';

function timestamp(): string {
  return new Date().toISOString().replace(/[-:]/gu, '').replace(/\.\d{3}/u, '');
}

@Controller('api/exports/research')
export class ExportController {
  constructor(
    @Inject(ResearchExportService) private readonly researchExport: ResearchExportService,
    @Inject(AppLoggerService) private readonly logger: AppLoggerService,
    @Inject(InMemoryResearchDownloadStore) private readonly downloads: InMemoryResearchDownloadStore = new InMemoryResearchDownloadStore()
  ) {}

  @Post(':format')
  async export(@Param('format') format: unknown, @Res() response: Response, @Body() body: unknown, @Req() request: RequestWithId): Promise<void> {
    await this.renderAndRespond(format, response, body, request);
  }

  @Post(':format/link')
  async createLink(@Param('format') format: unknown, @Res() response: Response, @Body() body: unknown, @Req() request: RequestWithId): Promise<void> {
    const startedAt = Date.now();
    try {
      const result = await this.researchExport.export({
        format,
        report: body && typeof body === 'object' && !Array.isArray(body) ? (body as { report?: unknown }).report : undefined
      });
      const filename = `financial-research-${timestamp()}.${result.extension}`;
      const link = this.downloads.create(result, filename);
      response.setHeader('Cache-Control', 'no-store');
      response.status(200).json({
        downloadUrl: `/api/exports/research/download/${link.token}`,
        filename: link.filename,
        expiresAt: new Date(link.expiresAt).toISOString(),
        format: result.extension
      });
      this.logger.info({ event: 'research_export_link_created', requestId: request.requestId, durationMs: Date.now() - startedAt });
    } catch (error) {
      const publicError = toPublicError(error);
      this.logger.error({ event: 'research_export_link_failed', requestId: request.requestId, errorCode: publicError.body.errorCode, durationMs: Date.now() - startedAt });
      response.status(publicError.status).json(publicError.body);
    }
  }

  @Get('download/:token')
  async download(@Param('token') token: string, @Res() response: Response, @Req() request: RequestWithId): Promise<void> {
    const startedAt = Date.now();
    const artifact = this.downloads.get(token);
    if (!artifact) {
      const publicError = toPublicError(new AppError('not_found'));
      this.logger.error({ event: 'research_download_failed', requestId: request.requestId, errorCode: publicError.body.errorCode, durationMs: Date.now() - startedAt });
      response.status(publicError.status).json(publicError.body);
      return;
    }
    response.status(200);
    response.setHeader('Content-Type', artifact.mediaType);
    response.setHeader('Content-Length', String(artifact.body.length));
    response.setHeader('Content-Disposition', `attachment; filename="${artifact.filename}"`);
    response.setHeader('Cache-Control', 'private, no-store');
    response.end(artifact.body);
    this.logger.info({ event: 'research_download_completed', requestId: request.requestId, durationMs: Date.now() - startedAt });
  }

  private async renderAndRespond(format: unknown, response: Response, body: unknown, request: RequestWithId): Promise<void> {
    const startedAt = Date.now();
    try {
      const result = await this.researchExport.export({
        format,
        report: body && typeof body === 'object' && !Array.isArray(body) ? (body as { report?: unknown }).report : undefined
      });
      const filename = `financial-research-${timestamp()}.${result.extension}`;
      response.status(200);
      response.setHeader('Content-Type', result.mediaType);
      response.setHeader('Content-Length', String(result.body.length));
      response.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      response.setHeader('Cache-Control', 'no-store');
      response.end(result.body);
      this.logger.info({ event: 'research_export_completed', requestId: request.requestId, durationMs: Date.now() - startedAt });
    } catch (error) {
      const publicError = toPublicError(error);
      this.logger.error({ event: 'research_export_failed', requestId: request.requestId, errorCode: publicError.body.errorCode, durationMs: Date.now() - startedAt });
      response.status(publicError.status).json(publicError.body);
    }
  }
}
