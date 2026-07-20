import ReactMarkdown from 'react-markdown';

function toolLabel(name) {
  return {
    get_weather: '天气查询',
    search_news: '新闻检索',
    search_asset: '资产搜索',
    get_quote: '行情查询'
  }[name] ?? name;
}

export function MessageItem({ message, streaming }) {
  const isStreamingAssistant = streaming && message.role === 'assistant' && message.status === 'streaming';
  const toolEvents = message.role === 'assistant' && Array.isArray(message.toolEvents)
    ? message.toolEvents.filter((event) => event && typeof event === 'object' && !Array.isArray(event))
    : [];

  return (
    <article className={`message ${message.role}${isStreamingAssistant ? ' streaming' : ''}`}>
      <div className="message-meta">
        <span>{message.role}</span>
        <span>{message.status}</span>
        {isStreamingAssistant && <span className="streaming-label">生成中</span>}
      </div>
      {message.role === 'assistant' ? (
        <ReactMarkdown
          components={{
            a(props) {
              return <a {...props} target="_blank" rel="noreferrer" />;
            },
            code({ children }) {
              return <code>{children}</code>;
            }
          }}
        >
          {message.content || '...'}
        </ReactMarkdown>
      ) : (
        <p>{message.content}</p>
      )}
      {toolEvents.length > 0 && (
        <section className="tool-events" aria-label="数据来源与工具调用">
          <h3>数据来源与工具调用</h3>
          <ul>
            {toolEvents.map((event, index) => (
              <li key={[event.type, event.name, event.symbol, index].join('-')}>
                {event.type === 'tool' ? (
                  <span>调用 {toolLabel(event.name)}</span>
                ) : event.type !== 'tool_result' ? (
                  <span>{toolLabel(event.name)} · 未知工具事件</span>
                ) : !event.ok ? (
                  <span>{toolLabel(event.name)} · 错误 {event.errorCode ?? 'unknown_error'}</span>
                ) : event.name === 'search_news' ? (
                  <section className="web-search-sources" aria-label="新闻检索结果">
                    <h4>新闻检索结果</h4>
                    <p className="freshness-meta">
                      服务器 {event.result?.serverTime ?? '未知'} · 最新数据 {event.result?.latestPublishedAt ?? '无'} · 相差 {event.result?.latestAgeSeconds ?? '未知'} 秒
                    </p>
                    <ul>
                      {Array.isArray(event.result?.sources) && event.result.sources.slice(0, 5)
                        .filter((source) => source && typeof source === 'object' && !Array.isArray(source))
                        .map((source, sourceIndex) => (
                        <li key={`${source.title}-${sourceIndex}`}>
                          <strong>{source.title ?? '未命名新闻'}</strong>
                          <span>{source.publisher} · <time dateTime={source.publishedAt}>{source.publishedAt}</time></span>
                        </li>
                        ))}
                    </ul>
                  </section>
                ) : event.name === 'get_weather' ? (
                  <section className="live-weather" aria-label="实时天气来源">
                    <h4>实时天气</h4>
                    <p>{event.result?.weather?.city ?? event.result?.location ?? '当前位置'} · {event.result?.weather?.temperatureC ?? '未知'}°C，体感 {event.result?.weather?.apparentTemperatureC ?? '未知'}°C</p>
                    <span>服务器 {event.result?.serverTime ?? '未知'} · 观测 <time dateTime={event.result?.weather?.observedAt}>{event.result?.weather?.observedAt ?? '未知'}</time> · 相差 {event.result?.weather?.ageSeconds ?? '未知'} 秒 · {event.result?.weather?.timeZone ?? '未知'} · 来源 {event.result?.weather?.source ?? '未知'}</span>
                  </section>
                ) : event.name === 'search_asset' ? (
                  <section className="live-context" aria-label="资产搜索结果">
                    <h4>资产搜索结果</h4>
                    <ul>
                      {Array.isArray(event.result) && event.result.map((asset, assetIndex) => (
                        <li key={`${asset.symbol ?? 'asset'}-${assetIndex}`}>{asset.name ?? asset.symbol ?? '未命名资产'} · {asset.symbol ?? '未解析代码'} · {asset.market ?? '未知市场'}</li>
                      ))}
                    </ul>
                  </section>
                ) : event.name === 'get_quote' ? (
                  <section className="live-context" aria-label="行情查询结果">
                    <h4>行情查询结果</h4>
                    <p>{event.result?.meta?.symbol ?? '未解析代码'} · {event.result?.data?.price ?? '未知'} {event.result?.data?.currency ?? ''} · 涨跌 {event.result?.data?.changePercent ?? '未知'}%</p>
                    <span>来源 {event.result?.meta?.source ?? '未知'} · 观测 {event.result?.meta?.observedAt ?? event.result?.meta?.asOf ?? '未知'} · 延迟 {event.result?.meta?.delay ?? '未知'}</span>
                  </section>
                ) : (
                  <span>{toolLabel(event.name)} · 已返回结果</span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </article>
  );
}
