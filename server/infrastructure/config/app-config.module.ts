import { Global, Module, type DynamicModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppConfigService, parseAppConfig } from './app-config.service.js';

@Global()
@Module({})
export class AppConfigModule {
  static forRoot(environment: NodeJS.ProcessEnv = process.env): DynamicModule {
    const config = parseAppConfig(environment);
    return {
      module: AppConfigModule,
      global: true,
      imports: [ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true })],
      providers: [{ provide: AppConfigService, useValue: new AppConfigService(config) }],
      exports: [AppConfigService]
    };
  }
}
