import http from 'node:http';
import express from 'express';
import { loadEnv } from './env.js';
import { streamDeepSeek } from './deepseek.js';
import { attachWebSocket } from './websocket.js';
import { createMarketGateway } from './market/gateway.js';
import { createAssetSearch } from './market/search.js';
import { resolveLiveContext } from './tools/live.js';
import { createToolRegistry } from './tools/registry.js';
import { searchWeb } from './tools/web.js';

loadEnv();

const app = express();
const port = Number(process.env.PORT || 8787);
const clientUrl = process.env.CLIENT_URL || 'http://127.0.0.1:5173';
const marketGateway = createMarketGateway();
const assetSearch = createAssetSearch();
const toolRegistry = createToolRegistry({
  liveContext: resolveLiveContext,
  webSearch: searchWeb,
  marketGateway,
  assetSearch
});

// Only trust forwarded client IPs when a deployment proxy is explicitly configured.
if (process.env.TRUST_PROXY === 'true') app.set('trust proxy', 1);
app.use(express.json({ limit: '1mb' }));
app.use((_, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', clientUrl);
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  next();
});
app.options('/{*path}', (_, res) => res.sendStatus(204));
app.get('/api/health', (_, res) => res.json({ ok: true }));
app.get('/api/market/search', async (req, res) => {
  const query = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  if (!query || query.length > 64) {
    return res.status(400).json({ error: 'q must contain 1 to 64 characters' });
  }
  return res.json({ results: await assetSearch(query) });
});
app.post('/api/chat/stream', (req, res) => streamDeepSeek(req, res, { toolRegistry }));

const server = http.createServer(app);
attachWebSocket(server);

server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`端口 ${port} 已被占用。请先停止旧的 demo 进程，或修改 .env 里的 PORT。`);
    process.exit(1);
  }
  throw error;
});

server.listen(port, '127.0.0.1', () => {
  console.log(`DeepSeek demo server: http://127.0.0.1:${port}`);
});
