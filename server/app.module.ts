import { Module, type DynamicModule, type MiddlewareConsumer, type NestModule } from '@nestjs/common';
import { ChatController } from './api/chat/chat.controller.js';
import { ApprovalController } from './api/approval/approval.controller.js';
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
import { FailoverModelClient } from './infrastructure/deepseek/failover-model-client.js';
import { ModelPlanner } from './infrastructure/deepseek/model-planner.js';
import { ResilientModelClient } from './infrastructure/deepseek/resilient-model-client.js';
import { UnavailableModelClient } from './infrastructure/deepseek/unavailable-model-client.js';
import { ModelRouter } from './infrastructure/deepseek/model-router.js';
import { ModelRegistry } from './infrastructure/deepseek/model-registry.js';
import { AppLoggerService } from './infrastructure/logging/app-logger.service.js';
import { RuntimeTelemetry } from './infrastructure/runtime/runtime-telemetry.js';
import { InstrumentedToolExecutor } from './infrastructure/runtime/instrumented-tool-executor.js';
import { ResearchDocumentRenderer } from './infrastructure/export/research-document-renderer.js';
import { InMemoryResearchDownloadStore } from './infrastructure/export/research-download.store.js';
import { createToolRegistryExecutor } from './infrastructure/tools/tool-registry.adapter.js';
import { ResearchCoordinator } from './agent/research-coordinator.js';
import { SubAgentRegistry } from './agent/sub-agent-registry.js';
import { InMemoryApprovalCoordinator } from './agent/approval-coordinator.js';
import { CapabilitiesController } from './api/capabilities/capabilities.controller.js';
import { TaskController } from './api/tasks/task.controller.js';
import { DocumentsController } from './api/documents/documents.controller.js';
import { CitationsController } from './api/citations/citations.controller.js';
import { BrowserController } from './api/browser/browser.controller.js';
import { CapabilityRegistry } from './application/capabilities/capability.registry.js';
import { DocumentIngestionService } from './application/documents/document-ingestion.service.js';
import { InMemoryTaskRuntime } from './application/tasks/task-runtime.js';
import { TaskNotificationService } from './application/tasks/task-notification.service.js';
import { BackgroundTaskService } from './application/tasks/background-task.service.js';
import { createEconomicCalendarGateway } from './economic-calendar/gateway.js';
import { createMarketGateway } from './market/gateway.js';
import { createAssetSearch } from './market/search.js';
import { resolveLiveContext } from './tools/live.js';
import { searchWeb } from './tools/web.js';
import { PdfOcrDocumentExtractor } from './infrastructure/documents/document-extractor.js';
import { CitationProxyService } from './application/citations/citation-proxy.service.js';
import { SandboxBrowserExecutor } from './browser/browser-executor.js';
import { BrowserPolicy } from './browser/browser-policy.js';
import { HttpEmbeddingProvider } from './infrastructure/documents/embedding-provider.js';
import { HashEmbeddingProvider } from './application/chat/document-retrieval.js';

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
      controllers: [HealthController, MetricsController, MarketController, ChatController, ApprovalController, ExportController, CapabilitiesController, TaskController, DocumentsController, CitationsController, BrowserController],
      providers: [
        AppLoggerService,
        {
          provide: CapabilityRegistry,
          useFactory: () => new CapabilityRegistry()
        },
        {
          provide: CitationProxyService,
          useFactory: () => new CitationProxyService()
        },
        {
          provide: InMemoryTaskRuntime,
          useFactory: () => new InMemoryTaskRuntime()
        },
        TaskNotificationService,
        BackgroundTaskService,
        {
          provide: SandboxBrowserExecutor,
          inject: [AppConfigService],
          useFactory: (config: AppConfigService) => new SandboxBrowserExecutor({
            policy: new BrowserPolicy({
              allowedDomains: config.value.browserAllowedDomains ?? []
            })
          })
        },
        {
          provide: InMemoryResearchDownloadStore,
          useFactory: () => new InMemoryResearchDownloadStore()
        },
        {
          provide: DocumentIngestionService,
          inject: [AppConfigService],
          useFactory: (config: AppConfigService) => new DocumentIngestionService(new PdfOcrDocumentExtractor({
            ocrLanguage: config.value.ocrLanguage,
            ...(config.value.tesseractLangPath ? { ocrLangPath: config.value.tesseractLangPath } : {}),
            ...(config.value.tesseractWorkerPath ? { ocrWorkerPath: config.value.tesseractWorkerPath } : {}),
            ...(config.value.tesseractCorePath ? { ocrCorePath: config.value.tesseractCorePath } : {})
          }))
        },
        {
          provide: InMemoryApprovalCoordinator,
          useFactory: () => new InMemoryApprovalCoordinator()
        },
        {
          provide: SubAgentRegistry,
          useFactory: () => new SubAgentRegistry()
        },
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
            const primaryConfigured = Boolean(config.value.deepSeekApiKey);
            const fallback = config.value.modelFallback;
            const routeConfigs = config.value.modelRoutes ?? {};
            telemetry.setModelConfigured(primaryConfigured || Boolean(fallback) || Object.keys(routeConfigs).length > 0);

            const createResilientClient = (apiKey: string, baseUrl: string, model: string): ModelClient => new ResilientModelClient(
              new DeepSeekClient({ apiKey, baseUrl, model }),
              telemetry,
              config.value.modelResilience
            );

            const primary = primaryConfigured
              ? createResilientClient(config.value.deepSeekApiKey!, config.value.deepSeekBaseUrl, config.value.deepSeekModel)
              : new ResilientModelClient(new UnavailableModelClient(), telemetry, config.value.modelResilience);
            const defaultClient = fallback
              ? new FailoverModelClient(
                primary,
                createResilientClient(fallback.apiKey, fallback.baseUrl, fallback.model),
                () => telemetry.recordModelFailover()
              )
              : primary;
            const routes = Object.fromEntries(Object.entries(routeConfigs).map(([taskType, route]) => {
              const routeClient = createResilientClient(route!.apiKey, route!.baseUrl, route!.model);
              return [taskType, new FailoverModelClient(routeClient, defaultClient, () => telemetry.recordModelFailover())];
            }));
            if (Object.keys(routes).length === 0) return defaultClient;
            const registry = new ModelRegistry();
            for (const [taskType, routeClient] of Object.entries(routes)) {
              registry.register({
                id: `configured:${taskType}`,
                taskTypes: [taskType as 'fast' | 'reasoning' | 'structured'],
                inputPricePerMillion: 0,
                outputPricePerMillion: 0,
                maxContextTokens: 128_000,
                structuredOutput: true,
                latencyMs: 1_000,
                healthy: true,
                client: routeClient
              });
            }
            return new ModelRouter(defaultClient, routes, registry);
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
          inject: [ASSET_SEARCH, RuntimeTelemetry, CitationProxyService],
          useFactory: (assetSearch: ReturnType<typeof createAssetSearch>, telemetry: RuntimeTelemetry, citations: CitationProxyService): ToolExecutor => new InstrumentedToolExecutor(
            createToolRegistryExecutor({
              assetSearch,
              economicCalendar: createEconomicCalendarGateway().getWeek,
              liveContext: resolveLiveContext,
              marketGateway: createMarketGateway(),
              webSearch: searchWeb
            }),
            telemetry,
            Date.now,
            citations
          )
        },
        {
          provide: AGENT_RUNNER,
          inject: [MODEL_CLIENT, TOOL_EXECUTOR, PLANNER, InMemoryApprovalCoordinator, SubAgentRegistry],
          useFactory: (model: ModelClient, tools: ToolExecutor, planner: Planner, approval: InMemoryApprovalCoordinator, subAgents: SubAgentRegistry): AgentRunner => {
            const delegatePlanner = new ModelPlanner(model);
            return new LangGraphAgentRunner({
              model,
              tools,
              planner,
              coordinator: new ResearchCoordinator(model, subAgents, delegatePlanner.planSubAgents.bind(delegatePlanner)),
              approval
            });
          }
        },
        {
          provide: ChatApplicationService,
          inject: [AGENT_RUNNER, AppConfigService],
          useFactory: (runner: AgentRunner, config: AppConfigService) => new ChatApplicationService({
            runner,
            embeddingProvider: config.value.embedding
              ? new HttpEmbeddingProvider(config.value.embedding.endpoint, config.value.embedding.apiKey, config.value.embedding.model)
              : new HashEmbeddingProvider()
          })
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
