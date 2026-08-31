import ReactMarkdown from 'react-markdown';
import { useState } from 'react';
import { downloadResearchReport, type ResearchDocumentFormat } from '../lib/research-export.js';
import { AgentPlan } from './AgentPlan.js';
import type { ApprovalEvent, ChatRecord, ToolEvent } from '../types.js';

type UnknownRecord = Record<string, unknown>;
type TechnicalIndicators = {
  close: number;
  sma14: number;
  rsi14: number;
  asOf: string;
  source: string;
  symbol: string;
  interval: string;
  range: string;
};
type EconomicCalendarEvent = {
  time: string;
  country: string;
  title: string;
  impact: 'low' | 'medium' | 'high' | 'holiday';
  actual?: string;
  forecast?: string;
  previous?: string;
};
type EconomicCalendar = { events: EconomicCalendarEvent[]; source: string; fetchedAt: string };

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function display(value: unknown, fallback: string): string {
  return typeof value === 'string' || typeof value === 'number' ? String(value) : fallback;
}

function safeText(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim();
  return normalized.length > 0 && normalized.length <= maxLength ? normalized : undefined;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function isoTime(value: unknown): string | undefined {
  const normalized = safeText(value, 64);
  return normalized && Number.isFinite(Date.parse(normalized)) ? normalized : undefined;
}

function technicalIndicatorResult(value: unknown): TechnicalIndicators | undefined {
  if (!isRecord(value) || !isRecord(value.data) || !isRecord(value.meta)) return undefined;
  const close = finiteNumber(value.data.close);
  const sma14 = finiteNumber(value.data.sma14);
  const rsi14 = finiteNumber(value.data.rsi14);
  const asOf = isoTime(value.data.asOf);
  const source = safeText(value.meta.source, 128);
  const symbol = safeText(value.meta.symbol, 64);
  const interval = safeText(value.meta.interval, 8);
  const range = safeText(value.meta.range, 16);
  if (close === undefined || sma14 === undefined || rsi14 === undefined || !asOf || !source || !symbol || !interval || !range) return undefined;
  return { close, sma14, rsi14, asOf, source, symbol, interval, range };
}

function economicCalendarEvent(value: unknown): EconomicCalendarEvent | undefined {
  if (!isRecord(value)) return undefined;
  const time = isoTime(value.time);
  const country = safeText(value.country, 8);
  const title = safeText(value.title, 200);
  const impact = safeText(value.impact, 16);
  if (!time || !country || !title || (impact !== 'low' && impact !== 'medium' && impact !== 'high' && impact !== 'holiday')) return undefined;
  const actual = safeText(value.actual, 80);
  const forecast = safeText(value.forecast, 80);
  const previous = safeText(value.previous, 80);
  return { time, country, title, impact, ...(actual ? { actual } : {}), ...(forecast ? { forecast } : {}), ...(previous ? { previous } : {}) };
}

function economicCalendarResult(value: unknown): EconomicCalendar | undefined {
  if (!isRecord(value) || !Array.isArray(value.events) || !isRecord(value.meta)) return undefined;
  const source = safeText(value.meta.source, 64);
  const fetchedAt = isoTime(value.meta.fetchedAt);
  const events = value.events.map(economicCalendarEvent);
  if (!source || !fetchedAt || events.some((event) => !event)) return undefined;
  return { source, fetchedAt, events: events as EconomicCalendarEvent[] };
}

function toolLabel(name: string): string {
  return {
    get_weather: '天气查询',
    search_news: '新闻检索',
    search_asset: '资产搜索',
    get_quote: '行情查询',
    get_technical_indicators: '技术指标',
    get_economic_calendar: '经济日历'
  }[name] ?? name;
}

function eventRecords(events: readonly ToolEvent[] | undefined): readonly ToolEvent[] {
  return events ?? [];
}

function ApprovalCard({ approval }: { approval: ApprovalEvent }) {
  const [decision, setDecision] = useState<'pending' | 'approved' | 'rejected' | 'error'>('pending');
  const [error, setError] = useState('');

  async function decide(next: 'approved' | 'rejected'): Promise<void> {
    if (decision !== 'pending') return;
    setError('');
    try {
      const response = await fetch('/api/approvals/' + encodeURIComponent(approval.id) + '/' + next, { method: 'POST' });
      if (!response.ok) {
        const payload = await response.json().catch((): { errorCode?: unknown } => ({})) as { errorCode?: unknown };
        throw new Error(typeof payload.errorCode === 'string' ? payload.errorCode : '审批失败：' + response.status);
      }
      setDecision(next);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '审批失败');
      setDecision('error');
    }
  }

  return <section className="approval-card" aria-label="工具执行审批">
    <header><h3>等待工具审批</h3><span>{decision === 'pending' ? '待处理' : decision === 'approved' ? '已批准' : decision === 'rejected' ? '已拒绝' : '审批失败'}</span></header>
    <p>模型准备调用以下只读工具：</p>
    <ul>{approval.calls.map((call, index) => <li key={[call.name, call.id ?? index].join('-')}>{toolLabel(call.name)}</li>)}</ul>
    {decision === 'pending' ? <div className="approval-actions">
      <button type="button" onClick={() => void decide('approved')}>批准</button>
      <button type="button" onClick={() => void decide('rejected')}>拒绝</button>
    </div> : <p className="approval-status">{decision === 'approved' ? '已批准，Agent 将继续执行。' : decision === 'rejected' ? '已拒绝，Agent 将基于当前上下文回答。' : '审批请求未完成，请重试本轮对话。'}</p>}
    {error && <p className="research-export-error" role="alert">{error}</p>}
  </section>;
}

function ResearchReportCard({ report }: { report: NonNullable<ChatRecord['researchReport']> }) {
  const [downloading, setDownloading] = useState<ResearchDocumentFormat | null>(null);
  const [error, setError] = useState('');
  async function download(format: ResearchDocumentFormat): Promise<void> {
    setDownloading(format);
    setError('');
    try {
      await downloadResearchReport(report, format);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '导出失败');
    } finally {
      setDownloading(null);
    }
  }
  return <section className="research-report" aria-label="结构化研究结果"><h3>{report.title}</h3><p>{report.conclusion}</p><section><h4>依据</h4><ul>{report.evidence.map((item, index) => <li key={`${item.source}-${index}`}>{item.claim} · {item.source}{item.observedAt ? ` · ${item.observedAt}` : ''}</li>)}</ul></section><section><h4>风险提示</h4><ul>{report.risks.map((risk, index) => <li key={`${risk}-${index}`}>{risk}</li>)}</ul></section>{report.asOf && <p className="freshness-meta">数据时间：{report.asOf}</p>}<div className="research-export-actions" aria-label="研究报告导出"><button type="button" disabled={downloading !== null} onClick={() => void download('pdf')}>{downloading === 'pdf' ? '正在导出 PDF...' : '导出 PDF'}</button><button type="button" disabled={downloading !== null} onClick={() => void download('pptx')}>{downloading === 'pptx' ? '正在导出 PPTX...' : '导出 PPTX'}</button></div>{error && <p className="research-export-error" role="alert">导出失败：{error}</p>}</section>;
}

function TechnicalIndicatorsCard({ indicators }: { indicators: TechnicalIndicators }) {
  return <section className="technical-indicators-card" aria-label="技术指标结果" aria-live="polite">
    <header><h4>技术指标</h4><span>{indicators.symbol}</span></header>
    <dl className="technical-indicators-grid">
      <div><dt>最新收盘</dt><dd>{indicators.close}</dd></div>
      <div><dt>SMA14</dt><dd>{indicators.sma14}</dd></div>
      <div><dt>RSI14</dt><dd>{indicators.rsi14}</dd></div>
    </dl>
    <p className="freshness-meta">{indicators.interval} · {indicators.range} · 来源 {indicators.source} · <time dateTime={indicators.asOf}>{indicators.asOf}</time></p>
  </section>;
}

function EconomicCalendarCard({ calendar }: { calendar: EconomicCalendar }) {
  return <section className="economic-calendar-card" aria-label="经济日历结果" aria-live="polite">
    <header><h4>经济日历</h4><span>{calendar.events.length} 项</span></header>
    {calendar.events.length > 0 ? <ul className="economic-calendar-list">{calendar.events.slice(0, 8).map((event, index) => (
      <li key={`${event.time}-${event.country}-${index}`}>
        <span className={`economic-impact ${event.impact}`}>{event.impact}</span>
        <div><strong>{event.country} · {event.title}</strong><time dateTime={event.time}>{event.time}</time></div>
        {(event.actual || event.forecast || event.previous) && <p>实际 {event.actual ?? '—'} · 预期 {event.forecast ?? '—'} · 前值 {event.previous ?? '—'}</p>}
      </li>
    ))}</ul> : <p className="economic-calendar-empty">当前周没有可展示的日历事件。</p>}
    <p className="freshness-meta">来源 {calendar.source} · 获取于 <time dateTime={calendar.fetchedAt}>{calendar.fetchedAt}</time></p>
  </section>;
}

export function MessageItem({ message, streaming, onRetry }: { message: ChatRecord; streaming: boolean; onRetry?: () => void }) {
  const isStreamingAssistant = streaming && message.role === 'assistant' && message.status === 'streaming';
  const toolEvents = message.role === 'assistant' ? eventRecords(message.toolEvents) : [];
  const agentEvents = message.role === 'assistant' ? (message.agentEvents ?? []) : [];

  return (
    <article className={`message ${message.role}${isStreamingAssistant ? ' streaming' : ''}`}>
      <div className="message-meta">
        <span>{message.role}</span>
        <span>{message.status}</span>
        {message.taskId && <span>任务 {message.taskId.slice(0, 8)}</span>}
        {isStreamingAssistant && <span className="streaming-label">生成中</span>}
      </div>
      {message.role === 'assistant' && <AgentPlan plan={message.plan} />}
      {message.role === 'assistant' && message.approval && <ApprovalCard approval={message.approval} />}
      {message.role === 'assistant' && message.citations && message.citations.length > 0 && (
        <section className="citation-ledger" aria-label="引用账本">
          <h3>引用账本</h3>
          <ul>{message.citations.map((citation) => (
            <li key={citation.id}><strong>{citation.id}</strong><span>{citation.label}</span>{citation.freshness && <em>{citation.expired ? '已过期' : citation.freshness === 'fresh' ? '新鲜' : '未知新鲜度'}</em>}</li>
          ))}</ul>
        </section>
      )}
      {message.role === 'assistant' && (message.status === 'error' || message.status === 'stopped') && onRetry && (
        <button className="message-retry" type="button" onClick={onRetry}>重新生成</button>
      )}
      {message.role === 'assistant' && message.researchReport ? <ResearchReportCard report={message.researchReport} /> : message.role === 'assistant' ? (
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
      {agentEvents.length > 0 && (
        <section className="agent-events" aria-label="协作代理">
          <h3>协作代理</h3>
          <ul>{agentEvents.map((event, index) => (
            <li key={`${event.role}-${event.status}-${index}`}>
              <span>{event.role === 'researcher' ? '研究员' : event.role === 'risk_reviewer' ? '风险复核员' : event.role}</span>
              <span>{event.status === 'started' ? '已启动' : event.status === 'completed' ? '已完成' : '已跳过'}</span>
            </li>
          ))}</ul>
        </section>
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
              const technicalIndicators = technicalIndicatorResult(toolResult?.result);
              const economicCalendar = economicCalendarResult(toolResult?.result);
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
                          <strong>{display(source.citationId, `来源 ${sourceIndex + 1}`)} · {display(source.title, '未命名新闻')}</strong>
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
                  ) : event.name === 'get_technical_indicators' && technicalIndicators ? (
                    <TechnicalIndicatorsCard indicators={technicalIndicators} />
                  ) : event.name === 'get_economic_calendar' && economicCalendar ? (
                    <EconomicCalendarCard calendar={economicCalendar} />
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
