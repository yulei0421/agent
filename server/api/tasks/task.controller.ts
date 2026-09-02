import { Controller, Get, Param, Post, Query, Res, Optional } from '@nestjs/common';
import type { Response } from 'express';
import { AppError, toPublicError } from '../../domain/errors/app-error.js';
import { InMemoryTaskRuntime } from '../../application/tasks/task-runtime.js';
import { TaskNotificationService } from '../../application/tasks/task-notification.service.js';

@Controller('api/tasks')
export class TaskController {
  constructor(private readonly tasks: InMemoryTaskRuntime, @Optional() private readonly notifications?: TaskNotificationService) {}

  @Get(':id')
  get(@Param('id') id: string, @Res() response: Response): void {
    const summary = this.tasks.summary(id);
    if (!summary) {
      const error = toPublicError(new AppError('not_found'));
      response.status(error.status).json(error.body);
      return;
    }
    response.status(200).json(summary);
  }

  @Post(':id/cancel')
  cancel(@Param('id') id: string, @Res() response: Response): void {
    const summary = this.tasks.cancel(id);
    if (!summary) {
      const error = toPublicError(new AppError('not_found'));
      response.status(error.status).json(error.body);
      return;
    }
    void this.notifications?.publish(summary);
    response.status(200).json(summary);
  }

  @Get(':id/events')
  events(@Param('id') id: string, @Query('after') after: string | undefined, @Res() response: Response): void {
    const sequence = after && /^\d+$/u.test(after) ? Number(after) : 0;
    const events = this.tasks.events(id, sequence);
    if (!this.tasks.summary(id)) {
      const error = toPublicError(new AppError('not_found'));
      response.status(error.status).json(error.body);
      return;
    }
    response.status(200).json({ events });
  }

  @Post(':id/retry')
  retry(@Param('id') id: string, @Res() response: Response): void {
    const handle = this.tasks.retry(id);
    if (!handle) {
      const error = toPublicError(new AppError('task_conflict'));
      response.status(error.status).json(error.body);
      return;
    }
    const summary = this.tasks.summary(id);
    if (summary) void this.notifications?.publish(summary);
    response.status(200).json(summary);
  }
}
