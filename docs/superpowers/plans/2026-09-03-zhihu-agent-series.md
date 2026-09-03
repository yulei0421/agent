# 知乎 Agent 系列文章写作执行计划

> **供执行者使用：** 必须使用 `superpowers:subagent-driven-development`（推荐）或 `superpowers:executing-plans`，逐项执行本计划。所有步骤使用复选框跟踪。

**目标：** 基于当前项目 README 和已确认的系列设计，完成三篇各约 2500～3500 字、定位互不重复的中文知乎文章。

**组织方式：** 三篇文章分别承担实战复盘、技术教程和产品能力分析。每篇独立创建、核对、提交并推送；最后进行跨文章事实一致性与重复度检查，只在确有问题时追加修订提交。

**技术与格式：** 中文 Markdown、Mermaid、TypeScript 伪代码、Git。

---

## 文件结构

- 创建 `docs/zhihu/01-agent-routing-to-langgraph.md`：记录从硬编码关键词路由到 LangGraph 自主工具决策的工程演进。
- 创建 `docs/zhihu/02-typescript-nestjs-langgraph-agent.md`：讲解 TypeScript、NestJS、LangGraph、ToolManifest 和 SSE 的实现边界。
- 创建 `docs/zhihu/03-financial-agent-capability-map.md`：从产品视角介绍金融 Agent 能力、安全边界和未完成事项。
- 参考 `README.md`：作为当前能力、运行方式和限制的主要事实来源。
- 参考 `docs/superpowers/specs/2026-09-03-zhihu-agent-series-design.md`：作为文章定位、结构和验收标准。

### 任务一：完成实战复盘文章

**文件：**

- 创建：`docs/zhihu/01-agent-routing-to-langgraph.md`
- 参考：`README.md`
- 参考：`docs/superpowers/specs/2026-09-03-zhihu-agent-series-design.md`

- [ ] **步骤 1：创建文章骨架**

  按以下固定顺序建立标题和章节：

  ```markdown
  # 我把写死在代码里的 Agent 路由，改成了模型自主决策

  > 摘要

  ## 一开始，我只是想让它查个天气
  ## 关键词路由为什么一定会失控
  ## 把工具选择交给模型，不等于让模型执行代码
  ## 真正可控的工具调用链路
  ## Planner 曾经存在，却没有真正参与决策
  ## LangGraph 如何接管自主循环
  ## 流式输出与桌面端带来的真实踩坑
  ## 我最终保留的工程边界
  ## 写在最后
  ```

- [ ] **步骤 2：完成问题与演进叙事**

  写清以下事实和因果关系：

  - 早期通过代码规则判断天气、行情或新闻意图。
  - 未覆盖问法、同义表达和组合问题会让条件分支不断膨胀。
  - 新方案把用户消息和部署期工具清单交给模型选择。
  - 模型只能返回工具名和结构化参数，不能生成并执行任意 TypeScript 或 JavaScript。
  - 服务端始终负责工具存在性、参数 schema、风险等级、超时和执行器。

- [ ] **步骤 3：完成 Planner 与 LangGraph 复盘**

  解释旧实现中 `plan/currentStep` 不参与模型和工具路由时为什么只是展示层状态，并用以下图示表达新流程：

  ```mermaid
  flowchart LR
    U[用户消息] --> P[Planner]
    P --> M[模型决策]
    M -->|调用工具| V[服务端校验]
    V --> T[执行受控工具]
    T --> M
    M -->|无需工具或达到上限| A[最终回答]
  ```

  同时说明三轮、六次工具调用等停止上限属于服务端收敛策略，不由模型自行解除。

- [ ] **步骤 4：补充真实踩坑与结论**

  覆盖 SSE 增量输出、同轮工具并行但事件保持原顺序、首事件前模型故障切换、Electron 安装版 `.env` 查找路径等问题。结尾提炼“模型拥有决策空间，服务端拥有执行控制权”。

- [ ] **步骤 5：核对文章长度、敏感信息和事实**

  运行：

  ```bash
  wc -m docs/zhihu/01-agent-routing-to-langgraph.md
  rg -n "sk-|DEEPSEEK_API_KEY=.+[^_]$|/Users/|保证收益|自动交易" docs/zhihu/01-agent-routing-to-langgraph.md
  git diff --check -- docs/zhihu/01-agent-routing-to-langgraph.md
  ```

  预期：Markdown 总字符数与约 2500～3500 字正文相符；敏感信息和夸大表述搜索无结果；`git diff --check` 退出码为 0。

- [ ] **步骤 6：提交并推送第一篇**

  ```bash
  git add docs/zhihu/01-agent-routing-to-langgraph.md
  git commit -m "docs: add Zhihu article about Agent routing evolution"
  git push origin main
  ```

### 任务二：完成技术教程文章

**文件：**

- 创建：`docs/zhihu/02-typescript-nestjs-langgraph-agent.md`
- 参考：`README.md`
- 参考：`server/agent/`
- 参考：`server/application/`

- [ ] **步骤 1：创建文章骨架**

  按以下固定顺序建立标题和章节：

  ```markdown
  # 用 TypeScript、NestJS 和 LangGraph 搭建一个可控的 AI Agent

  > 摘要

  ## 先看完整架构
  ## 第一步：把工具定义成部署期能力
  ## 第二步：设计 Agent 状态
  ## 第三步：建立 Planner、模型与工具循环
  ## 第四步：让并行执行保持确定顺序
  ## 第五步：用 SSE 输出完整运行状态
  ## 第六步：处理模型超时、重试、熔断与降级
  ## 第七步：加入取消、审批和后台任务
  ## 如何测试这套 Agent
  ## 可以复用的最小架构
  ```

- [ ] **步骤 2：绘制系统与循环图**

  第一张图展示 React/Electron、NestJS、应用层、AgentRunner、LangGraph、模型和工具适配器的边界。第二张图展示 `Planner -> Model -> Tools -> Model -> Final` 循环。明确应用层依赖 AgentRunner 接口，不直接依赖 LangGraph 具体实现。

- [ ] **步骤 3：编写核心 TypeScript 示例**

  使用简化伪代码分别展示：

  ```ts
  interface ToolManifest<TInput> {
    readonly name: string;
    readonly description: string;
    readonly risk: "read_only";
    readonly timeoutMs: number;
    parse(input: unknown): TInput;
    execute(input: TInput, signal: AbortSignal): Promise<unknown>;
  }
  ```

  ```ts
  interface AgentState {
    readonly messages: readonly AgentMessage[];
    readonly plan?: AgentPlan;
    readonly currentStep?: number;
    readonly toolRounds: number;
    readonly toolCalls: number;
  }
  ```

  ```ts
  for await (const event of agentRunner.stream(request, signal)) {
    response.write(`data: ${JSON.stringify(event)}\n\n`);
  }
  ```

  示例用于说明接口边界，不声称与仓库源码逐字一致。

- [ ] **步骤 4：完成可靠性与安全章节**

  说明闭合 schema、未知工具拒绝、子 `AbortSignal`、并行执行、原顺序回传、SSE keep-alive、首事件超时、单次重试、熔断、备用模型、人工审批和任务 TTL。明确备用模型只在首个可见事件前失败时接管，避免拼接两个回答。

- [ ] **步骤 5：完成测试策略**

  按工具契约、图状态迁移、SSE 解析、取消传播、模型故障、Electron sidecar 和 TypeScript 类型检查分类说明，并给出：

  ```bash
  pnpm typecheck
  pnpm test
  pnpm build
  ```

- [ ] **步骤 6：核对文章长度、代码和事实**

  运行：

  ```bash
  wc -m docs/zhihu/02-typescript-nestjs-langgraph-agent.md
  rg -n "sk-|DEEPSEEK_API_KEY=.+[^_]$|/Users/|eval\\(|new Function" docs/zhihu/02-typescript-nestjs-langgraph-agent.md
  git diff --check -- docs/zhihu/02-typescript-nestjs-langgraph-agent.md
  ```

  预期：文章长度符合约 2500～3500 字目标；示例不包含真实密钥和任意代码执行方案；格式检查通过。

- [ ] **步骤 7：提交并推送第二篇**

  ```bash
  git add docs/zhihu/02-typescript-nestjs-langgraph-agent.md
  git commit -m "docs: add TypeScript LangGraph Agent tutorial"
  git push origin main
  ```

### 任务三：完成金融 Agent 产品文章

**文件：**

- 创建：`docs/zhihu/03-financial-agent-capability-map.md`
- 参考：`README.md`
- 参考：`docs/agent-capability-gap-analysis.md`
- 参考：`docs/production-capabilities.md`

- [ ] **步骤 1：创建文章骨架**

  按以下固定顺序建立标题和章节：

  ```markdown
  # 一个金融 AI Agent 应该具备哪些能力？这是我的完整答案

  > 摘要

  ## 聊天框并不等于金融 Agent
  ## 第一层：理解用户正在研究什么
  ## 第二层：获得带时间和来源的数据
  ## 第三层：拆解目标并进行受限分工
  ## 第四层：处理文档、记忆与引用
  ## 第五层：把回答变成可交付成果
  ## 第六层：支持长任务和桌面工作流
  ## 金融场景必须明确的安全边界
  ## 目前仍然没有解决的问题
  ## 从 Demo 到产品，我得到的判断
  ```

- [ ] **步骤 2：完成能力分层**

  使用以下能力图，逐层解释金融上下文、受控工具、研究协作、知识输入、交付和运行保障：

  ```mermaid
  flowchart TB
    A[研究交互层] --> B[目标规划与受限子 Agent]
    B --> C[行情 新闻 指标 日历等工具]
    C --> D[引用 新鲜度 风险校验]
    D --> E[结构化报告 PDF PPTX]
    E --> F[任务 取消 重试 通知 Electron]
  ```

- [ ] **步骤 3：写清已经实现的业务能力**

  覆盖金融工作台、资产上下文、六个只读工具、研究员与风险复核员、PDF/图片 OCR、请求级检索、受控引用、结构化报告、PDF/PPTX 导出、后台任务、取消重试、通知扩展点和 Electron 客户端。

- [ ] **步骤 4：写清安全边界和未完成事项**

  明确项目不执行交易，不保证实时性或收益；模型不能注册工具、生成任意执行代码或访问任意 URL。明确服务端持久化记忆、跨设备会话、持久化任务队列、生产级数据授权与完整审计仍未完成。

- [ ] **步骤 5：核对文章长度、免责声明和事实**

  运行：

  ```bash
  wc -m docs/zhihu/03-financial-agent-capability-map.md
  rg -n "sk-|DEEPSEEK_API_KEY=.+[^_]$|/Users/|保证收益|自动下单|已经生产可用" docs/zhihu/03-financial-agent-capability-map.md
  git diff --check -- docs/zhihu/03-financial-agent-capability-map.md
  ```

  预期：文章长度符合约 2500～3500 字目标；不存在密钥、收益承诺或超出项目现状的能力声明；格式检查通过。

- [ ] **步骤 6：提交并推送第三篇**

  ```bash
  git add docs/zhihu/03-financial-agent-capability-map.md
  git commit -m "docs: add financial Agent capability article"
  git push origin main
  ```

### 任务四：进行系列一致性复核

**文件：**

- 检查：`docs/zhihu/01-agent-routing-to-langgraph.md`
- 检查：`docs/zhihu/02-typescript-nestjs-langgraph-agent.md`
- 检查：`docs/zhihu/03-financial-agent-capability-map.md`
- 对照：`README.md`

- [ ] **步骤 1：检查标题、摘要和章节完整性**

  运行：

  ```bash
  for article in docs/zhihu/*.md; do
    echo "$article"
    rg -n "^# |^> 摘要|^## " "$article"
  done
  ```

  预期：每篇只有一个一级标题，包含摘要和设计中要求的全部二级章节。

- [ ] **步骤 2：检查系列重复与术语一致性**

  对照三篇文章，确保 `ToolManifest`、`AgentRunner`、LangGraph、SSE、Planner、模型路由和 Electron 的含义一致。第一篇侧重演进，第二篇侧重实现，第三篇侧重业务价值；相同解释不连续重复超过一个短段落。

- [ ] **步骤 3：执行最终格式检查**

  运行：

  ```bash
  git diff --check
  git status --short --branch
  ```

  预期：没有空白错误；除用户已有的 `.DS_Store` 外没有未提交的文章修改。

- [ ] **步骤 4：仅在复核发现问题时提交修订**

  ```bash
  git add docs/zhihu
  git commit -m "docs: refine Zhihu Agent article series"
  git push origin main
  ```

  若复核未产生修改，则不创建空提交。
