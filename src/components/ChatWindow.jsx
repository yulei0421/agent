import { useState } from 'react';
import { MessageList } from './MessageList.jsx';

export function ChatWindow({ messages, streaming, financialMode, financialSymbol, onSend, onStop }) {
  const [content, setContent] = useState('');
  const placeholder = financialMode
    ? '输入金融问题和显式代码，例如 600519.SH、0700.HK、AAPL、BTC/USDT'
    : '问 DeepSeek 一个问题...';

  return (
    <section className={financialMode ? 'chat financial-chat financial-chat-panel' : 'chat'}>
      {financialMode && (
        <header className="financial-context">
          <p className="eyebrow">Market context</p>
          <h1>Copilot 对话</h1>
          <p>当前资产：<strong>{financialSymbol}</strong>。输入明确的市场代码后，可在回答中查看本次查询的数据来源与工具调用记录。</p>
        </header>
      )}
      <MessageList messages={messages} streaming={streaming} />
      <form className="composer" onSubmit={(event) => {
        event.preventDefault();
        const value = content.trim();
        if (!value || streaming) return;
        setContent('');
        onSend(value);
      }}>
        <textarea
          aria-label={financialMode ? '金融对话输入' : '聊天输入'}
          value={content}
          onChange={(event) => setContent(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
            event.preventDefault();
            event.currentTarget.form?.requestSubmit();
          }}
          placeholder={placeholder}
        />
        <div className="web-search-control">
          <span className="web-search-toggle">模型工具</span>
          <p>模型会在需要时调用受限工具；每次调用及结果都会显示在回答下方。</p>
        </div>
        <div className="composer-actions">
          <button type="button" onClick={onStop} disabled={!streaming}>停止生成</button>
          <button type="submit" disabled={streaming || !content.trim()}>发送</button>
        </div>
      </form>
    </section>
  );
}
