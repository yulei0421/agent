# Nest 运行时组成根收敛设计

## 目标

将生产请求链路统一到 Nest 组成根，令 HTTP、SSE、WebSocket、LangGraph Agent、工具和市场查询共享同一套显式依赖装配；旧 Express 入口不再作为可执行服务端。

## 现状与问题

- 迁移前 `package.json` 的 `server` 脚本执行 `server/index.ts`，它独立创建 Express 应用、工具注册表和 DeepSeek 流程；该入口现已删除。
- `server/main.ts` 已创建 Nest 应用，但只注册健康检查和市场搜索；聊天服务、DeepSeek 客户端和工具适配器没有被注入或调用。
- 原 `server/deepseek.ts` 的历史协议实现已移入 `server/legacy/`，只供历史回归测试使用，不参与生产请求链路。
- 这使测试可能覆盖新架构而真实进程仍走旧实现，造成行为与安全策略漂移。

## 目标结构

```text
api (Nest controllers / gateways)
  -> application (ChatApplicationService, MarketSearchService)
  -> domain (消息、工具端口、错误类型)
  -> infrastructure (DeepSeekClient、ToolRegistryAdapter、市场提供商)
```

- API 层只负责协议转换：请求解析、客户端取消、SSE 写入和 HTTP 错误映射。
- Application 层编排用例，不引用 Nest、Express、HTTP 请求或第三方 SDK。
- Domain 层定义跨层数据、端口与错误码；不得导入基础设施或 API 模块。
- Infrastructure 层实现端口；旧市场和工具模块在迁移期作为被适配的供应商实现，不向上泄漏。
- `AppModule` 是唯一依赖组成根；`main.ts` 是唯一可执行服务端入口。

## 迁移策略

1. 为聊天 SSE 建立 Nest 控制器，并把连接关闭映射为 `AbortSignal`，逐条输出 `AgentSseEvent`。
2. 在 `AppModule` 绑定 `DeepSeekClient`、工具注册表适配器、市场搜索服务与聊天应用服务；配置仅由 `AppConfigService` 提供。
3. 将 WebSocket 连接状态功能迁移为 Nest WebSocket 网关或明确的 Nest 生命周期 provider。
4. 删除 `server/index.ts`；把历史 DeepSeek 和 Express 市场搜索处理器隔离到 `server/legacy/`，禁止生产入口导入。
5. 更新脚本、README 和架构测试，证明生产启动脚本不再导入旧入口，且聊天请求确实经过应用服务与 LangGraph。

## 不变量

- 客户端不能提供 system/tool 消息或越过工具白名单。
- 断开连接必须取消模型和工具调用，且不得继续写 SSE。
- 市场搜索的取消保持 `499 request_aborted` 语义。
- SSE 事件保持 `delta`、`reasoning`、`tool`、`tool_result`、`error`、`done` 合同。
- 所有模型、工具和市场供应商依赖均可在测试中替换。

## 验证

- 单元测试：聊天控制器取消、SSE 格式、依赖注入、错误映射。
- 架构测试：运行时脚本只进入 `main.ts`，应用层不依赖 Nest/Express，旧 DeepSeek 流程不参与请求链路。
- 全量：`pnpm typecheck`、`pnpm test`、`pnpm build`，并以真实 Nest 实例验证 `/api/health`、市场搜索和聊天流。
