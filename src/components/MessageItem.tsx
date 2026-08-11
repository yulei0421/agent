import ReactMarkdown from 'react-markdown';
import type { ChatRecord, ToolEvent } from '../types.js';

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function display(value: unknown, fallback: string): string {
  return typeof value === 'string' || typeof value === 'number' ? String(value) : fallback;
}

function toolLabel(name: string): string {
  return {
    get_weather: '天气查询',
    search_news: '新闻检索',
    search_asset: '资产搜索',
    get_quote: '行情查询'
  }[name] ?? name;
}

function eventRecords(events: readonly ToolEvent[] | undefined): readonly ToolEvent[] {
  return events ?? [];
}

export function MessageItem({ message, streaming }: { message: ChatRecord; streaming: boolean }) {
  const isStreamingAssistant = streaming && message.role === 'assistant' && message.status === 'streaming';
  const toolEvents = message.role === 'assistant' ? eventRecords(message.toolEvents) : [];

  return (
    <article className={`message ${message.role}${isStreamingAssistant ? ' streaming' : ''}`}>
      <div className="message-meta">
        <span>{message.role}</span>
        <span>{message.status}</span>
        {isStreamingAssistant && <span className="streaming-label">生成中</span>}
      </div>
      {message.role === 'assistant' ? (
        <ReactMarkdown components={{
          a(props) {
            return <a {...props} target="_blank" rel="noreferrer" />;
          },
          code({ children }) {
            return <code>{children}</code>;
          }
        }}>
          {message.content || '...'}
        </ReactMarkdown>
      ) : (
        <p>{message.content}</p>
      )}
      {toolEvents.length > 0 && (
        <section className="tool-events" aria-label="数据来源与工具调用">
          <h3>数据来源与工具调用</h3>
          <ul>
            {toolEvents.map((event, index) => {
              const toolResult = event.type === 'tool_result' && event.ok ? event : undefined;
              const result = toolResult && isRecord(toolResult.result) ? toolResult.result : {};
              const weather = isRecord(result.weather) ? result.weather : {};
              const quoteData = isRecord(result.data) ? result.data : {};
              const quoteMeta = isRecord(result.meta) ? result.meta : {};
              const sources = Array.isArray(result.sources) ? result.sources.filter(isRecord) : [];
              const assets = Array.isArray(toolResult?.result)
                ? toolResult.result.filter(isRecord)
                : [];
              return (
                <li key={[event.type, event.name, event.id, index].join('-')}>
                  {event.type === 'tool' ? (
                    <span>调用 {toolLabel(event.name)}</span>
                  ) : !event.ok ? (
                    <span>{toolLabel(event.name)} · 错误 {event.errorCode}</span>
                  ) : event.name === 'search_news' ? (
                    <section className="web-search-sources" aria-label="新闻检索结果">
                      <h4>新闻检索结果</h4>
                      <p className="freshness-meta">
                        服务器 {display(result.serverTime, '未知')} · 最新数据 {display(result.latestPublishedAt, '无')} · 相差 {display(result.latestAgeSeconds, '未知')} 秒
                      </p>
                      <ul>{sources.slice(0, 5).map((source, sourceIndex) => (
                        <li key={`${display(source.title, 'source')}-${sourceIndex}`}>
                          <strong>{display(source.title, '未命名新闻')}</strong>
                          <span>{display(source.publisher, '未知来源')} · <time dateTime={display(source.publishedAt, '')}>{display(source.publishedAt, '未知')}</time></span>
                        </li>
                      ))}</ul>
                    </section>
                  ) : event.name === 'get_weather' ? (
                    <section className="live-weather" aria-label="实时天气来源">
                      <h4>实时天气</h4>
                      <p>{display(weather.city ?? result.location, '当前位置')} · {display(weather.temperatureC, '未知')}°C，体感 {display(weather.apparentTemperatureC, '未知')}°C</p>
                      <span>服务器 {display(result.serverTime, '未知')} · 观测 <time dateTime={display(weather.observedAt, '')}>{display(weather.observedAt, '未知')}</time> · 相差 {display(weather.ageSeconds, '未知')} 秒 · {display(weather.timeZone, '未知')} · 来源 {display(weather.source, '未知')}</span>
                    </section>
                  ) : event.name === 'search_asset' ? (
                    <section className="live-context" aria-label="资产搜索结果">
                      <h4>资产搜索结果</h4>
                      <ul>{assets.map((asset, assetIndex) => (
                        <li key={`${display(asset.symbol, 'asset')}-${assetIndex}`}>{display(asset.name, display(asset.symbol, '未命名资产'))} · {display(asset.symbol, '未解析代码')} · {display(asset.market, '未知市场')}</li>
                      ))}</ul>
                    </section>
                  ) : event.name === 'get_quote' ? (
                    <section className="live-context" aria-label="行情查询结果">
                      <h4>行情查询结果</h4>
                      <p>{display(quoteMeta.symbol, '未解析代码')} · {display(quoteData.price, '未知')} {display(quoteData.currency, '')} · 涨跌 {display(quoteData.changePercent, '未知')}%</p>
                      <span>来源 {display(quoteMeta.source, '未知')} · 观测 {display(quoteMeta.observedAt ?? quoteMeta.asOf, '未知')} · 延迟 {display(quoteMeta.delay, '未知')}</span>
                    </section>
                  ) : (
                    <span>{toolLabel(event.name)} · 已返回结果</span>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </article>
  );
}
