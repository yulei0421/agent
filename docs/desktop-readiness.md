# 桌面端可行性与完善清单

## 结论

当前项目可以做成桌面端，推荐使用 Electron。原因是服务端已经是 Node.js + NestJS，浏览器沙箱使用 Playwright，Electron 可以直接复用这两部分；React/Vite 前端只需从开发服务器切换为加载打包后的 `dist`。

Tauri 也可行，但需要额外维护 Rust sidecar、Node 服务进程管理和 Playwright 运行时打包，迁移成本高于 Electron。

## 当前已经具备的桌面基础

- React/Vite 前端没有依赖浏览器扩展，IndexedDB、SSE、WebSocket 都可在 Electron renderer 中运行。
- NestJS 服务已经绑定回环地址，可作为本地 sidecar。
- PDF/OCR、PDF/PPTX 导出、LangGraph、Playwright 等能力都在服务端，桌面壳无需重写业务。
- 前端 API 使用相对路径，桌面端只需要在启动时注入本地服务 origin。
- 本地历史和工作记忆已使用 IndexedDB，符合“不做跨设备服务端记忆”的既有约束。

## 目前需要完善的项目问题

### P0：桌面安全

1. 当前本地 HTTP API 没有桌面专属鉴权。桌面应用应在启动时生成随机 session token，Nest 对除健康探针外的接口校验 `Authorization: Bearer <token>`，防止本机其他进程调用工具、导出或浏览器能力。
2. Electron 必须启用 `contextIsolation`、关闭 `nodeIntegration`、限制导航到应用 origin，并通过 preload 暴露最小化 API。
3. DeepSeek、Embedding 和第三方服务密钥不应写入 renderer 或打包资源，应使用系统密钥链（macOS Keychain、Windows Credential Manager、Linux Secret Service）。
4. Playwright 浏览器进程应由主进程/sidecar 管理，限制下载目录、临时目录和子进程权限。

### P1：进程与发布

1. 桌面端不能固定占用 8787/5173；主进程应选择随机回环端口，等待 `/api/health` 就绪后再加载 UI。
2. 生产构建需要增加 server bundle（当前 `vite build` 只构建 renderer），并处理 `pdfjs-dist`、Tesseract 资源、Playwright 浏览器运行时和 CJK 字体的打包路径。
3. 需要实现 sidecar 崩溃重启、退出时优雅关闭、单实例锁和启动超时提示。
4. 需要配置 Electron Builder/Forge、macOS notarization、Windows 签名、Linux AppImage/deb 和自动更新策略。

### P1：现有服务能力

1. 任务、引用、审批和浏览器待处理状态目前是内存实现；桌面端重启后会丢失。若只要求本机临时任务可以接受，否则需要独立的本地 SQLite/文件任务存储（仍不等于跨设备聊天记忆）。
2. `DocumentSecurityService` 默认是确定性启发式扫描，生产环境应注入 ClamAV/ICAP。
3. `ModelRegistry` 已支持能力、成本、延迟和健康度，但价格配置仍应从受控配置中心加载，而不是全部为 0。
4. 浏览器白名单为空时全部拒绝；发布包需要提供设置页和安全的域名白名单配置流程。
5. 后台任务通知目前有内存/Webhook 扩展点，桌面端还应接入系统通知和任务中心。

## 推荐实施顺序

1. Electron 主进程 + preload + 随机端口 sidecar。
2. 本地 API session token 和系统密钥链。
3. server bundle、资源路径和 Playwright 浏览器打包。
4. 单实例、崩溃恢复、优雅退出、系统通知。
5. Electron Builder 发布、签名、自动更新和安装包冒烟测试。

## 目标运行结构

```text
Electron main
├─ spawn Nest sidecar (127.0.0.1:随机端口)
├─ 生成/保存 session token（系统密钥链）
├─ 等待 /api/health
└─ BrowserWindow
   ├─ contextIsolation=true
   ├─ nodeIntegration=false
   └─ preload 暴露受限的桌面 API
      └─ React/Vite renderer -> http://127.0.0.1:<port>
```

