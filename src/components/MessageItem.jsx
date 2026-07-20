import ReactMarkdown from 'react-markdown';

function toolTarget(event) {
  if (event.name === 'search_web') return event.query;
  if (event.name === 'get_weather') return event.location ?? '当前 IP 所在地区';
  if (event.name === 'get_current_context') return '当前 IP 所在地区';
  return event.assetName ? `${event.assetName} · ${event.symbol ?? '未解析代码'}` : event.symbol;
}

function marketSymbol(event) {
  return event.symbol ?? '未解析代码';
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
                  <span>调用 {event.name} · {toolTarget(event)}</span>
                ) : event.name === 'search_web' && event.status === 'success' ? (
                  <section className="web-search-sources" aria-label="联网搜索来源">
                    <h4>联网搜索来源</h4>
                    <p className="freshness-meta">
                      服务器 {event.serverTime} · 最新数据 {event.latestPublishedAt ?? '无'} · 相差 {event.latestAgeSeconds ?? '未知'} 秒
                    </p>
                    <ul>
                      {Array.isArray(event.sources) && event.sources.slice(0, 5)
                        .filter((source) => source && typeof source === 'object' && !Array.isArray(source))
                        .map((source, sourceIndex) => (
                        <li key={`${source.url}-${sourceIndex}`}>
                          <a href={source.url} target="_blank" rel="noreferrer">{source.title}</a>
                          <span>{source.publisher} · <time dateTime={source.publishedAt}>{source.publishedAt}</time></span>
                        </li>
                        ))}
                    </ul>
                  </section>
                ) : event.name === 'get_weather' && event.status === 'success' ? (
                  <section className="live-weather" aria-label="实时天气来源">
                    <h4>实时天气</h4>
                    <p>{event.city} · {event.temperatureC}°C，体感 {event.apparentTemperatureC}°C</p>
                    <span>服务器 {event.serverTime} · 观测 <time dateTime={event.observedAt}>{event.observedAt}</time> · 相差 {event.ageSeconds} 秒 · {event.timeZone} · 来源 {event.source}</span>
                  </section>
                ) : event.name === 'get_current_context' && event.status === 'success' ? (
                  <section className="live-context" aria-label="实时日期上下文">
                    <h4>实时日期上下文</h4>
                    <p>{event.location} · 当地日期 {event.date}</p>
                    <span>服务器 {event.serverTime} · {event.timeZone} · 来源 {event.source}</span>
                  </section>
                ) : event.name === 'search_web' ? (
                  <span aria-label="联网搜索错误">{event.errorCode ?? 'unknown_error'}</span>
                ) : event.name === 'get_weather' || event.name === 'get_current_context' ? (
                  <span aria-label="实时数据错误">{event.name} · 错误 {event.errorCode ?? 'unknown_error'}</span>
                ) : event.status === 'success' ? (
                  <span>
                    {event.name} · {event.assetName ? `${event.assetName} · ` : ''}{marketSymbol(event)} · 币种 {event.currency ?? '未知'} · 来源 {event.source} · 观测 {event.observedAt ?? '未知'} · 拉取 {event.fetchedAt ?? '未知'} · 相差 {event.ageSeconds ?? '未知'} 秒 · 截止 {event.asOf ?? '未知'} · 延迟 {event.delay ?? '未知'}
                  </span>
                ) : (
                  <span>{event.name} · {event.assetName ? `${event.assetName} · ` : ''}{marketSymbol(event)} · 错误 {event.errorCode ?? 'unknown_error'}</span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </article>
  );
}
