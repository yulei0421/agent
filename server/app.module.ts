import { Module, type DynamicModule, type MiddlewareConsumer, type NestModule } from '@nestjs/common';
import { ChatController } from './api/chat/chat.controller.js';
import { ExportController } from './api/export/export.controller.js';
import { HealthController } from './api/health/health.controller.js';
import { MetricsController } from './api/health/metrics.controller.js';
import { MarketController } from './api/market/market.controller.js';
import { StatusGateway } from './api/status/status.gateway.js';
import { RequestIdMiddleware } from './api/request-id.middleware.js';
import { ChatApplicationService } from './application/chat/chat.service.js';
import { ResearchExportService } from './application/export/research-export.service.js';
import { AGENT_RUNNER, MODEL_CLIENT, PLANNER, TOOL_EXECUTOR, type AgentRunner, type ModelClient, type Planner } from './application/chat/chat.ports.js';
import { LangGraphAgentRunner } from './agent/langgraph-agent-runner.js';
import { MarketSearchService } from './application/market/market-search.service.js';
import type { ToolExecutor } from './domain/tools/tool.types.js';
import { AppConfigModule } from './infrastructure/config/app-config.module.js';
import { AppConfigService, type AppConfig } from './infrastructure/config/app-config.service.js';
import { DeepSeekClient } from './infrastructure/deepseek/deepseek-client.js';
import { ModelPlanner } from './infrastructure/deepseek/model-planner.js';
import { ResilientModelClient } from './infrastructure/deepseek/resilient-model-client.js';
import { UnavailableModelClient } from './infrastructure/deepseek/unavailable-model-client.js';
import { AppLoggerService } from './infrastructure/logging/app-logger.service.js';
import { RuntimeTelemetry } from './infrastructure/runtime/runtime-telemetry.js';
import { InstrumentedToolExecutor } from './infrastructure/runtime/instrumented-tool-executor.js';
import { ResearchDocumentRenderer } from './infrastructure/export/research-document-renderer.js';
import { createToolRegistryExecutor } from './infrastructure/tools/tool-registry.adapter.js';
import { createEconomicCalendarGateway } from './economic-calendar/gateway.js';
import { createMarketGateway } from './market/gateway.js';
import { createAssetSearch } from './market/search.js';
import { resolveLiveContext } from './tools/live.js';
import { searchWeb } from './tools/web.js';

const ASSET_SEARCH = Symbol('ASSET_SEARCH');

@Module({})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware).forRoutes('*');
  }

  static forRoot(environment: NodeJS.ProcessEnv = process.env): DynamicModule {
    return {
      module: AppModule,
      imports: [AppConfigModule.forRoot(environment)],
      controllers: [HealthController, MetricsController, MarketController, ChatController, ExportController],
      providers: [
        AppLoggerService,
        StatusGateway,
        RuntimeTelemetry,
        { provide: ASSET_SEARCH, useFactory: () => createAssetSearch() },
        {
          provide: MarketSearchService,
          inject: [ASSET_SEARCH],
          useFactory: (assetSearch: ReturnType<typeof createAssetSearch>) => new MarketSearchService(assetSearch)
        },
        {
          provide: MODEL_CLIENT,
          inject: [AppConfigService, RuntimeTelemetry],
          useFactory: (config: AppConfigService, telemetry: RuntimeTelemetry): ModelClient => {
            const configured = Boolean(config.value.deepSeekApiKey);
            telemetry.setModelConfigured(configured);
            const inner = configured
              ? new DeepSeekClient({ apiKey: config.value.deepSeekApiKey!, baseUrl: config.value.deepSeekBaseUrl, model: config.value.deepSeekModel })
              : new UnavailableModelClient();
            return new ResilientModelClient(inner, telemetry, config.value.modelResilience);
          }
        },
        {
          provide: PLANNER,
          inject: [MODEL_CLIENT],
          useFactory: (model: ModelClient): Planner => {
            const planner = new ModelPlanner(model);
            return planner.plan.bind(planner);
          }
        },
        {
          provide: TOOL_EXECUTOR,
          inject: [ASSET_SEARCH, RuntimeTelemetry],
          useFactory: (assetSearch: ReturnType<typeof createAssetSearch>, telemetry: RuntimeTelemetry): ToolExecutor => new InstrumentedToolExecutor(
            createToolRegistryExecutor({
              assetSearch,
              economicCalendar: createEconomicCalendarGateway().getWeek,
              liveContext: resolveLiveContext,
              marketGateway: createMarketGateway(),
              webSearch: searchWeb
            }),
            telemetry
          )
        },
        {
          provide: AGENT_RUNNER,
          inject: [MODEL_CLIENT, TOOL_EXECUTOR, PLANNER],
          useFactory: (model: ModelClient, tools: ToolExecutor, planner: Planner): AgentRunner => new LangGraphAgentRunner({ model, tools, planner })
        },
        {
          provide: ChatApplicationService,
          inject: [AGENT_RUNNER],
          useFactory: (runner: AgentRunner) => new ChatApplicationService({ runner })
        },
        {
          provide: ResearchExportService,
          inject: [AppConfigService],
          useFactory: (config: AppConfigService) => new ResearchExportService(new ResearchDocumentRenderer({ fontPath: config.value.pdfFontPath }))
        }
      ]
    };
  }
}
