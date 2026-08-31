import { Controller, Inject, Param, Post, Req, Res } from '@nestjs/common';
import type { Response } from 'express';
import { InMemoryApprovalCoordinator } from '../../agent/approval-coordinator.js';
import { toPublicError } from '../../domain/errors/app-error.js';
import { AppLoggerService } from '../../infrastructure/logging/app-logger.service.js';
import type { RequestWithId } from '../request-id.middleware.js';

@Controller('api/approvals')
export class ApprovalController {
  constructor(
    @Inject(InMemoryApprovalCoordinator) private readonly approvals: InMemoryApprovalCoordinator,
    @Inject(AppLoggerService) private readonly logger: AppLoggerService
  ) {}

  @Post(':id/:decision')
  async decide(@Param('id') id: string, @Param('decision') decision: string, @Res() response: Response, @Req() request: RequestWithId): Promise<void> {
    const startedAt = Date.now();
    if (decision !== 'approved' && decision !== 'rejected') {
      response.status(400).json({ errorCode: 'invalid_request' });
      return;
    }
    try {
      await this.approvals.resolve(id, { decision });
      response.status(200).json({ approvalId: id, decision });
      this.logger.info({ event: 'approval_decided', requestId: request.requestId, durationMs: Date.now() - startedAt });
    } catch (error) {
      const publicError = toPublicError(error);
      this.logger.error({ event: 'approval_failed', requestId: request.requestId, errorCode: publicError.body.errorCode, durationMs: Date.now() - startedAt });
      response.status(publicError.status).json(publicError.body);
    }
  }
}
