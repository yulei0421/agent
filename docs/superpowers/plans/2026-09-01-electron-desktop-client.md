# Electron 桌面客户端实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将现有 React + NestJS Agent 应用打包为安全的 Electron 桌面客户端，支持 macOS、Windows、Linux 安装包构建。

**Architecture:** Electron 主进程生成随机回环端口和会话令牌，启动编译后的 NestJS sidecar；sidecar 在生产环境托管 Vite renderer，使浏览器窗口与 API 同源。主进程使用 `webRequest` 仅向本地 sidecar 注入令牌，Renderer 不读取令牌且保持 `contextIsolation=true` 与 `nodeIntegration=false`。

**Tech Stack:** Electron、electron-builder、TypeScript、Vite、NestJS、Node child process、现有 Playwright/PDF/OCR 依赖。

---

### Task 1: 桌面运行时配置与令牌认证

**Files:**
- Create: `server/api/desktop-session.middleware.ts`
- Modify: `server/infrastructure/config/app-config.service.ts`
- Modify: `server/main.ts`
- Test: `tests/desktopSession.test.ts`

- [ ] **Step 1: 写入失败测试**

```ts
test('desktop sidecar rejects API calls without its session token', () => {
  const middleware = new DesktopSessionMiddleware('token');
  assert.equal(run(middleware, {}), 401);
});
```

- [ ] **Step 2: 运行测试并确认因模块不存在失败**

Run: `pnpm exec tsx --test tests/desktopSession.test.ts`

- [ ] **Step 3: 实现 token 配置、API 校验、静态 renderer 目录托管与健康探针绕过**

- [ ] **Step 4: 运行专项测试**

Run: `pnpm exec tsx --test tests/desktopSession.test.ts`

### Task 2: Electron 主进程和安全窗口

**Files:**
- Create: `electron/main.ts`
- Create: `electron/preload.ts`
- Create: `electron/sidecar.ts`
- Test: `tests/electronRuntime.test.ts`

- [ ] **Step 1: 写入失败测试**

```ts
test('desktop launch arguments use a random loopback port and a non-empty session token', () => {
  const args = createSidecarLaunchOptions();
  assert.match(args.token, /^[A-Za-z0-9_-]{32,}$/);
  assert.equal(args.host, '127.0.0.1');
});
```

- [ ] **Step 2: 运行测试并确认因模块不存在失败**

Run: `pnpm exec tsx --test tests/electronRuntime.test.ts`

- [ ] **Step 3: 实现 sidecar 启动、健康检查、主窗口、Header 注入、单实例和退出清理**

- [ ] **Step 4: 运行专项测试**

Run: `pnpm exec tsx --test tests/electronRuntime.test.ts`

### Task 3: 构建与安装包配置

**Files:**
- Create: `tsconfig.server.json`
- Create: `tsconfig.electron.json`
- Modify: `package.json`
- Modify: `.env.example`
- Test: `tests/electronPackaging.test.ts`

- [ ] **Step 1: 写入失败测试**

```ts
test('package manifest provides renderer, server, electron and package scripts', () => {
  const manifest = JSON.parse(readFileSync('package.json', 'utf8'));
  assert.ok(manifest.scripts['desktop:build']);
  assert.ok(manifest.build?.asarUnpack?.includes('dist-server/**'));
});
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `pnpm exec tsx --test tests/electronPackaging.test.ts`

- [ ] **Step 3: 配置 server/main 编译、Electron 编译、electron-builder 资源解包和发布目录**

- [ ] **Step 4: 运行构建**

Run: `pnpm desktop:build`

### Task 4: 文档与全量验证

**Files:**
- Modify: `README.md`
- Modify: `docs/desktop-readiness.md`

- [ ] **Step 1: 更新桌面启动、密钥、调试、浏览器资源和发布说明**
- [ ] **Step 2: 运行 `pnpm typecheck`、`pnpm test`、`pnpm desktop:build`、`git diff --check`**
