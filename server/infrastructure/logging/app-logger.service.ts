import { Injectable, Logger } from '@nestjs/common';

export interface SafeLogFields {
  requestId?: string;
  event: string;
  toolName?: string;
  errorCode?: string;
  durationMs?: number;
}

@Injectable()
export class AppLoggerService {
  private readonly logger = new Logger('Agent');

  info(fields: SafeLogFields): void {
    this.logger.log(JSON.stringify(fields));
  }

  error(fields: SafeLogFields): void {
    this.logger.error(JSON.stringify(fields));
  }
}
