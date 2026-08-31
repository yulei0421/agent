import { Body, Controller, Get, Param, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { AppError, toPublicError } from '../../domain/errors/app-error.js';
import { InMemoryTaskRuntime } from '../../application/tasks/task-runtime.js';

@Controller('api/tasks')
export class TaskController {
  constructor(private readonly tasks: InMemoryTaskRuntime) {}

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
    response.status(200).json(summary);
  }
}
