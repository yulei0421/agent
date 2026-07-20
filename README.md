# agent

金融 AI Agent 学习 Demo：React + Vite + SSE + WebSocket + IndexedDB + 虚拟滚动 + DeepSeek。

## 本地配置与运行

```bash
pnpm install
cp .env.example .env
```

编辑本地 `.env`。唯一必须填写的是 `DEEPSEEK_API_KEY`：

```env
DEEPSEEK_API_KEY=在这里填写你的apikey
```

`.env` 已被 Git 忽略，不能提交 API Key。请勿把密钥粘贴到 README、代码、Issue、提交信息或截图中；需要分享配置时只使用 `.env.example`。

### 配置项

| 配置项 | 是否必填 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `DEEPSEEK_API_KEY` | 是 | 无 | DeepSeek API Key。仅写入本地 `.env`。 |
| `DEEPSEEK_BASE_URL` | 否 | `https://api.deepseek.com` | DeepSeek 兼容 API 服务地址。 |
| `DEEPSEEK_MODEL` | 否 | `deepseek-v4-flash` | 请求使用的模型名称。请填写账户已开通的模型。 |
| `PORT` | 否 | `8787` | 本地 Node 服务端口。端口被占用时改为其他可用端口。 |
| `CLIENT_URL` | 否 | `http://127.0.0.1:5173` | 允许访问服务端的前端地址；前端端口变化时同步修改。 |
| `TRUST_PROXY` | 否 | `false` | 仅在恰好一层受信任反向代理转发客户端 IP 时设为 `true`。 |
| `BINANCE_REST_BASE_URL` | 否 | `https://api.binance.com` | 演示用公开行情数据源地址。 |

可直接以 `.env.example` 为模板：

```bash
cp .env.example .env
# 然后仅将 .env 中的 DEEPSEEK_API_KEY 替换为你自己的密钥
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
- 模型工具：服务端将 `get_weather`、`search_news`、`search_asset` 和 `get_quote` 统一注册给 DeepSeek，由模型在需要时选择调用。浏览器只提交对话消息，不能请求或关闭某个网络工具。
- 工具结果：SSE 会依次发送通用的调用和结果事件；前端展示天气、新闻、资产和行情卡片。新闻卡片仅显示经过清洗的标题、媒体和时间，不向浏览器下发原始来源 URL。

## 联网搜索说明

Google News RSS 仅适合个人或演示用途。生产环境必须替换为已获得授权、符合服务条款的新闻搜索服务，并按业务要求处理数据来源、隐私和可用性。

当模型调用天气工具时，用户明确给出城市会用于地理编码；未给出城市时，IP 才用于固定地理定位服务来获得城市与时区，且不会被应用持久化。部署在反向代理后时，只有确认恰好一层受信任代理时才将 `TRUST_PROXY=true` 写入 `.env`；否则保持默认 `false`，避免伪造的转发 IP 影响定位结果。

当模型调用新闻检索工具时，Google News RSS 条目的发布时间会与服务器当前时间比较：未来时间戳会被排除，剩余结果按发布时间倒序排列。模型仅能基于这些带来源的数据总结，不能把标题元数据当作已验证事实。

## 工具安全限制

- 只有上述四个命名工具可执行；参数必须匹配工具定义的字段、类型和长度限制，未知工具或无效参数会返回结构化错误。
- 单个回答最多进行 3 轮、6 次工具调用；达到上限后会禁用后续工具调用并要求模型直接回答。
- 每个工具结果都会在服务端清洗后才发送给模型和浏览器；新闻 URL、异常内部信息和未允许字段不会透传。

## 测试

```bash
pnpm test
```
