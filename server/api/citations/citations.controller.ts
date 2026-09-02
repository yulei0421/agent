import { Controller, Get, Param, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { CitationProxyService } from '../../application/citations/citation-proxy.service.js';
import { toPublicError } from '../../domain/errors/app-error.js';

@Controller('api/citations')
export class CitationsController {
  constructor(private readonly citations: CitationProxyService) {}

  @Get(':id')
  get(@Param('id') id: string, @Res() response: Response): void {
    try {
      response.status(200).json({ citation: this.citations.get(id) });
    } catch (error) {
      const publicError = toPublicError(error);
      response.status(publicError.status).json(publicError.body);
    }
  }

  @Post(':id/revalidate')
  async revalidate(@Param('id') id: string, @Req() request: Request, @Res() response: Response): Promise<void> {
    try {
      const result = await this.citations.revalidate(id, request.signal);
      response.status(200).json({ citation: result });
    } catch (error) {
      const publicError = toPublicError(error);
      response.status(publicError.status).json(publicError.body);
    }
  }
}
