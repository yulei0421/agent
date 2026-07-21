import { MessageItem } from './MessageItem.tsx';

export function MessageList({ messages, streaming }) {
  if (messages.length === 0) {
    return (
      <section className="message-list chat-empty-list" aria-live="polite">
        <div className="chat-empty-state">
          <p className="eyebrow">新会话</p>
          <h1>从一个问题开始</h1>
          <p>输入你的任务，必要时开启联网搜索；回答和数据来源会显示在这里。</p>
        </div>
      </section>
    );
  }

  return (
    <div className="message-list" aria-live="polite">
      {messages.map((message) => (
        <div className="message-slot" key={message.id}>
          <MessageItem message={message} streaming={streaming} />
        </div>
      ))}
    </div>
  );
}
