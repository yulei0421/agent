const MARKET_CONFIGS = Object.freeze({
  cn: Object.freeze({ configured: true, provider: 'eastmoney', delay: 'unknown' }),
  hk: Object.freeze({ configured: true, provider: 'tencent', delay: 'unknown' }),
  us: Object.freeze({ configured: true, provider: 'yahoo-finance', delay: 'unknown' }),
  crypto: Object.freeze({ configured: true, provider: 'binance', delay: 'exchange' })
});

const ALLOWED_ORIGINS = Object.freeze([
  'https://query1.finance.yahoo.com',
  'https://push2.eastmoney.com',
  'https://searchapi.eastmoney.com',
  'https://smartbox.gtimg.cn',
  'https://qt.gtimg.cn',
  'https://api.binance.com'
]);

export function getMarketConfig(market) {
  if (typeof market !== 'string' || !Object.hasOwn(MARKET_CONFIGS, market)) {
    throw new Error('Unsupported market');
  }

  return MARKET_CONFIGS[market];
}

export function getAllowedOrigins() {
  return ALLOWED_ORIGINS;
}
