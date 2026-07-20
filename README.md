# DeepSeek Agent Demo

学习版 AI 前端 Demo：React + Vite + SSE + WebSocket + IndexedDB + 虚拟滚动 + DeepSeek。

## 运行

```bash
pnpm install
cp .env.example .env
```

编辑 `.env`：

```env
DEEPSEEK_API_KEY=在这里填写你的apikey
```

启动：

```bash
pnpm dev
```

打开 Vite 输出的本地地址，通常是 `http://127.0.0.1:5173`。
本地 Node 代理默认监听 `http://127.0.0.1:8787`。

如果看到 `EADDRINUSE`，说明旧 demo 还在运行。先在旧终端按 `Ctrl+C`，再重新执行 `pnpm dev`。

如果你的终端里 `pnpm dev` 只启动了 Vite，可开两个终端分别运行：

```bash
node server/index.js
pnpm client
```

## 学习点

- SSE：`server/deepseek.js` 转发 DeepSeek 流式输出，`src/lib/chat.js` 消费。
- WebSocket：`server/websocket.js` 与 `src/lib/websocket.js` 展示双向连接。
- IndexedDB：`src/lib/db.js` 保存用户、会话、消息、离线队列。
- 虚拟滚动：`src/lib/virtualList.js` 控制消息列表渲染范围。
- Markdown：`src/components/MessageItem.jsx` 使用 `react-markdown`。
- 默认实时 Agent：天气、新闻/研报/公告和明确行情代码等时效问题会自动调用固定数据源；一般对话不会发起无关搜索。新闻使用固定的 Google News RSS（`hl=zh-CN`、`gl=CN`），并在回答下方展示最多 5 条来源。搜索结果是未验证的元数据，不能当作事实依据。
- 实时上下文：天气问题优先识别用户明确给出的城市；未给出城市时才按请求 IP 所在时区定位。天气工具调用固定地理编码服务与 Open-Meteo，并展示城市、服务器时间、观测时间、时差和来源。

## 联网搜索说明

Google News RSS 仅适合个人或演示用途。生产环境必须替换为已获得授权、符合服务条款的新闻搜索服务，并按业务要求处理数据来源、隐私和可用性。

实时天气会在匹配天气意图时自动调用。用户明确给出城市时，服务只请求固定地理编码服务；未给出城市时，IP 才用于请求固定地理定位服务来获得城市与时区，且不会被应用持久化。部署在反向代理后时，只有确认恰好一层受信任代理时才将 `TRUST_PROXY=true` 写入 `.env`；否则保持默认 `false`，避免伪造的转发 IP 影响定位结果。

新闻检索会将 RSS 条目的发布时间与服务器当前时间比较：未来时间戳会被排除，剩余结果按发布时间倒序排列，最新一条的发布时间与时差会随来源记录一起提供给 DeepSeek。模型仅能基于这些带来源的数据总结，不能把标题元数据当作已验证事实。

## 测试

```bash
pnpm test
```
