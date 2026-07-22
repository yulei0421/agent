import { Module } from '@nestjs/common';
import { AppConfigModule } from './infrastructure/config/app-config.module.js';

@Module({
  imports: [AppConfigModule]
})
export class AppModule {}
