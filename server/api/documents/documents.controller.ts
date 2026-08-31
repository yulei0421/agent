import { Body, Controller, Inject, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { DocumentIngestionService } from '../../application/documents/document-ingestion.service.js';
import { toPublicError } from '../../domain/errors/app-error.js';

@Controller('api/documents')
export class DocumentsController {
  constructor(@Inject(DocumentIngestionService) private readonly documents: DocumentIngestionService) {}

  @Post('ingest')
  async ingest(@Body() body: unknown, @Res() response: Response): Promise<void> {
    try {
      response.status(200).json({ document: await this.documents.ingest(body) });
    } catch (error) {
      const publicError = toPublicError(error);
      response.status(publicError.status).json(publicError.body);
    }
  }
}
