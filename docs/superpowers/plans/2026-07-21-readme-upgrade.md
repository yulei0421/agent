# README Upgrade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将根目录 README 升级为完整、准确且可执行的功能与架构说明。

**Architecture:** 仅修改项目入口文档，不改变前后端运行逻辑。README 以“概览到细节”的顺序串联用户界面、服务端接口、模型工具、行情网关和本地持久化，并以当前源代码和环境模板为唯一事实来源。

**Tech Stack:** Markdown、React 19、Vite 7、Express 5、DeepSeek 兼容 API、SSE、WebSocket、IndexedDB、LangGraph。

---

### Task 1: 建立文档事实清单

**Files:**
- Modify: `README.md`
- Reference: `.env.example`
- Reference: `package.json`
- Reference: `server/index.ts`
- Reference: `server/deepseek.ts`
- Reference: `server/tools/registry.ts`
- Reference: `server/market/config.ts`
- Reference: `server/agent/graph.ts`
- Reference: `src/App.tsx`
- Reference: `src/components/FinancialWorkspace.tsx`

- [ ] **Step 1: 核对启动命令、环境变量和 HTTP 路由**

Run:

```bash
sed -n '1,180p' package.json
sed -n '1,120p' .env.example
sed -n '1,140p' server/index.ts
```

Expected: `pnpm dev` 同时启动 Vite 与 Node 服务；当前对外路由为 `/api/health`、`/api/market/search`、`/api/chat/stream` 和 `/ws`。

- [ ] **Step 2: 核对功能模块与能力边界**

Run:

```bash
rg -n "get_weather|get_quote|search_asset|search_news|financialTabs|createPlanningGraph" server src
```

Expected: 四个模型工具、五个金融工作台页签和独立的 LangGraph 规划模块均能在源码中定位；规划模块不被写成在线聊天链路的一部分。

### Task 2: 重写项目入口文档

**Files:**
- Modify: `README.md`

- [ ] **Step 1: 写入分层文档结构**

将 `README.md` 重组为以下章节，并在每节只描述可由源码验证的行为：

```markdown
# DeepSeek 金融 AI Agent Demo

## 项目概览
## 核心功能
## 界面与使用流程
## 系统架构
## 请求与数据流
## 本地运行
## 配置项
## 服务接口与事件
## 模型工具与市场数据
## 安全与隐私边界
## 工程结构
## 测试与构建
## 限制与免责声明
```

- [ ] **Step 2: 在架构和数据流章节说明职责边界**

写入一张 ASCII 架构图，表达浏览器、Express 服务、DeepSeek、工具注册表、外部数据源和 IndexedDB 的关系；随后分别说明聊天 SSE、资产搜索 HTTP 与 WebSocket 心跳的端到端流向。将 `server/agent/` 写为“独立且可复用的规划模块”，不承诺它参与当前 HTTP 请求。

- [ ] **Step 3: 写入安全、数据质量与产品限制**

明确以下不可省略事项：密钥仅存于 `.env`；`TRUST_PROXY=true` 仅适用于单层受信任代理；工具调用受名称、参数、轮次和次数限制；工具输出清洗后才能到达模型和浏览器；市场和新闻数据仅用于演示与研究；项目不提供交易执行或投资建议。

### Task 3: 校验文档与项目基线

**Files:**
- Modify: `README.md`
- Test: `tests/*.test.ts`

- [ ] **Step 1: 检查 README 的关键事实和 Markdown 结构**

Run:

```bash
rg -n "DEEPSEEK_API_KEY|/api/chat/stream|/api/market/search|/ws|get_weather|search_news|search_asset|get_quote|LangGraph|投资建议" README.md
node --input-type=module -e "const text = await (await import('node:fs/promises')).readFile('README.md', 'utf8'); if (!text.startsWith('# ') || text.includes('TODO') || text.includes('TBD')) process.exit(1); console.log('README structure OK');"
```

Expected: 所有关键术语出现，且命令输出 `README structure OK`。

- [ ] **Step 2: 运行回归检查**

Run:

```bash
pnpm test
pnpm typecheck
pnpm build
```

Expected: 三条命令退出码均为 0；若构建生成已跟踪文件变化，只提交 README，不混入其他文件。

- [ ] **Step 3: 单独提交 README 更新**

Run:

```bash
git add README.md
git commit -m "docs: expand project README"
git status --short
```

Expected: 提交只包含 `README.md`；已有的 `server/` 未提交修改仍保持原样。
