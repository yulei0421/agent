import { useState } from 'react';

function formatHistoryTime(timestamp) {
  const value = new Date(timestamp);
  if (Number.isNaN(value.getTime())) return '刚刚';

  const now = new Date();
  const sameDay = value.toDateString() === now.toDateString();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const time = value.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });

  if (sameDay) return time;
  if (value.toDateString() === yesterday.toDateString()) return `昨天 ${time}`;
  return `${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')} ${time}`;
}

function ConversationIcon() {
  return (
    <svg aria-hidden="true" fill="none" viewBox="0 0 24 24">
      <path d="M5.5 5.5h13v9h-7.1L8 17.4v-2.9H5.5z" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
      <path d="M9 9h6M9 11.8h4" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
    </svg>
  );
}

export function Sidebar({ user, sessions, activeSessionId, financialMode, onFinancialMode, onCreate, onSelect, onDelete, onLogout, onClear }) {
  const [historyExpanded, setHistoryExpanded] = useState(false);
  const visibleSessions = historyExpanded ? sessions : sessions.slice(0, 5);

  return (
    <aside className="sidebar">
      <div>
        <p className="eyebrow">Local User</p>
        <h2>{user.name}</h2>
      </div>
      <button onClick={onCreate}>新建会话</button>
      <button
        className="financial-entry"
        type="button"
        aria-pressed={financialMode}
        onClick={onFinancialMode}
      >
        金融对话
      </button>
      <nav className="session-list" aria-label="对话历史">
        <p className="session-list-title">对话历史</p>
        {visibleSessions.map((session) => (
          <div className={`session-row ${session.id === activeSessionId ? 'active' : ''}`} key={session.id}>
            <button
              aria-current={session.id === activeSessionId ? 'page' : undefined}
              className="session-select"
              onClick={() => onSelect(session.id)}
              type="button"
            >
              <span className="session-history-icon"><ConversationIcon /></span>
              <span className="session-history-copy">
                <span className="session-history-title">{session.title}</span>
                <time dateTime={session.updatedAt}>{formatHistoryTime(session.updatedAt)}</time>
              </span>
            </button>
            <button aria-label={`删除会话：${session.title}`} className="icon-button" title="删除会话" onClick={() => onDelete(session.id)} type="button">×</button>
          </div>
        ))}
        {sessions.length > 5 && (
          <button className="history-more" type="button" onClick={() => setHistoryExpanded((expanded) => !expanded)}>
            {historyExpanded ? '收起历史' : '查看更多历史'}
          </button>
        )}
      </nav>
      <div className="sidebar-footer">
        <button onClick={onClear}>清空历史</button>
        <button onClick={onLogout}>退出</button>
      </div>
    </aside>
  );
}
