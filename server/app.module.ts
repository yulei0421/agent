import { Module, type DynamicModule } from '@nestjs/common';
import { ChatController } from './api/chat/chat.controller.js';
import { HealthController } from './api/health/health.controller.js';
import { MarketController } from './api/market/market.controller.js';
import { ChatApplicationService } from './application/chat/chat.service.js';
import { MODEL_CLIENT, TOOL_EXECUTOR, type ModelClient } from './application/chat/chat.ports.js';
import { MarketSearchService } from './application/market/market-search.service.js';
import type { ToolExecutor } from './domain/tools/tool.types.js';
import { AppConfigModule } from './infrastructure/config/app-config.module.js';
import { AppConfigService, type AppConfig } from './infrastructure/config/app-config.service.js';
import { DeepSeekClient } from './infrastructure/deepseek/deepseek-client.js';
import { UnavailableModelClient } from './infrastructure/deepseek/unavailable-model-client.js';
import { createToolRegistryExecutor } from './infrastructure/tools/tool-registry.adapter.js';
import { createMarketGateway } from './market/gateway.js';
import { createAssetSearch } from './market/search.js';
import { resolveLiveContext } from './tools/live.js';
import { searchWeb } from './tools/web.js';

const ASSET_SEARCH = Symbol('ASSET_SEARCH');

@Module({})
export class AppModule {
  static forRoot(environment: NodeJS.ProcessEnv = process.env): DynamicModule {
    return {
      module: AppModule,
      imports: [AppConfigModule.forRoot(environment)],
      controllers: [HealthController, MarketController, ChatController],
      providers: [
        { provide: ASSET_SEARCH, useFactory: () => createAssetSearch() },
        {
          provide: MarketSearchService,
          inject: [ASSET_SEARCH],
          useFactory: (assetSearch: ReturnType<typeof createAssetSearch>) => new MarketSearchService(assetSearch)
        },
        {
          provide: MODEL_CLIENT,
          inject: [AppConfigService],
          useFactory: (config: AppConfigService): ModelClient => config.value.deepSeekApiKey
            ? new DeepSeekClient({ apiKey: config.value.deepSeekApiKey, baseUrl: config.value.deepSeekBaseUrl, model: config.value.deepSeekModel })
            : new UnavailableModelClient()
        },
        {
          provide: TOOL_EXECUTOR,
          inject: [ASSET_SEARCH],
          useFactory: (assetSearch: ReturnType<typeof createAssetSearch>): ToolExecutor => createToolRegistryExecutor({
            assetSearch,
            liveContext: resolveLiveContext,
            marketGateway: createMarketGateway(),
            webSearch: searchWeb
          })
        },
        {
          provide: ChatApplicationService,
          inject: [MODEL_CLIENT, TOOL_EXECUTOR],
          useFactory: (model: ModelClient, tools: ToolExecutor) => new ChatApplicationService({ model, tools })
        }
      ]
    };
  }
}
