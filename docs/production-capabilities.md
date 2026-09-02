# 生产能力边界与运行手册

本文记录当前六类 Agent 能力的服务端边界、默认实现和生产替换点。

## 输入安全

`DocumentSecurityService` 在解析前执行哈希、加密 PDF 拒绝、EICAR 启发式/注入式扫描和主体配额。生产环境应注入 ClamAV 或 ICAP 扫描器，并将扫描审计写入独立安全日志；不得把原始文件写入聊天记忆。

## 动态子 Agent

研究请求先由 `ModelPlanner.planSubAgents` 输出受限 JSON，再由 `ResearchCoordinator` 只允许注册角色、裁剪任务数量、超时和并发。`BudgetManager` 同时限制 token、美元成本、总时长和 Agent 数；计划失败自动回到固定安全角色。

## 引用 provenance

工具结果经 `InstrumentedToolExecutor` 写入 `CitationProxyService`，记录来源 ID、内容 SHA-256、请求 SHA-256、观测时间和工具链。客户端只能访问 `/api/citations/:id`，重验证必须经 `/revalidate`，原始 URL 不进入模型上下文。

## 多模型路由

`ModelRegistry` 保存任务能力、结构化输出、上下文上限、价格、延迟和健康度。`ModelRouter` 依据任务类型和估算输入 token 选择候选，并累计输入/输出 token 与估算费用；现有 Resilient/Failover 客户端继续负责超时、重试和熔断。

## 后台任务

将聊天请求体设置 `background: true` 即可脱离 SSE 执行。任务支持幂等键、事件序号回放、取消、失败/取消重试和通知扩展。默认实现为内存存储，生产环境应替换为 Redis/数据库队列和签名 Webhook；这不构成跨设备聊天记忆。

## 浏览器沙箱

`SandboxBrowserExecutor` 仅允许导航、点击、提取文本和截图。所有请求经过公共 DNS 白名单、内网/回环阻断、资源与时间上限、禁止下载和隔离上下文；点击动作必须通过人工审批。生产环境需安装 Playwright 浏览器运行时，并保留审计日志、截图和回放快照。
