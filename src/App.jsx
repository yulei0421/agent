import { useEffect, useMemo, useRef, useState } from 'react';
import { streamChat } from './lib/chat.js';
import { searchAssets } from './lib/market.js';
import { clear, getAll, id, now, put, remove } from './lib/db.js';
import { buildModelMessages, normalizeInterruptedMessages } from './lib/history.js';
import { connectStatusSocket } from './lib/websocket.js';
import { Login } from './components/Login.jsx';
import { Sidebar } from './components/Sidebar.jsx';
import { ChatWindow } from './components/ChatWindow.jsx';
import { StatusBar } from './components/StatusBar.jsx';
import { FinancialWorkspace } from './components/FinancialWorkspace.jsx';

const systemPrompt = {
  role: 'system',
  content: '你是一个用于学习 AI Agent 前端开发的助手，回答要简洁、结构清晰。'
};

export default function App() {
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState(null);
  const [sessions, setSessions] = useState([]);
  const [messages, setMessages] = useState([]);
  const [activeSessionId, setActiveSessionId] = useState('');
  const [wsStatus, setWsStatus] = useState('connecting');
  const [notice, setNotice] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState('');
  const [financialMode, setFinancialMode] = useState(false);
  const [financialTab, setFinancialTab] = useState('markets');
  const [financialSymbol, setFinancialSymbol] = useState('AAPL');
  const [assetQuery, setAssetQuery] = useState('AAPL');
  const [assetResults, setAssetResults] = useState([]);
  const [assetSearchState, setAssetSearchState] = useState('idle');
  const [activeAssetIndex, setActiveAssetIndex] = useState(-1);
  const [assetSearchOpen, setAssetSearchOpen] = useState(false);
  const abortRef = useRef(null);
  const assetSearchAbortRef = useRef(null);
  const researchContextRef = useRef(null);

  const activeMessages = useMemo(
    () => messages.filter((message) => message.sessionId === activeSessionId).sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    [messages, activeSessionId]
  );

  useEffect(() => {
    async function boot() {
      const [savedUsers, savedSessions, savedMessages] = await Promise.all([
        getAll('users'),
        getAll('sessions'),
        getAll('messages')
      ]);
      setUser(savedUsers[0] ?? null);
      setSessions(savedSessions.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
      const normalizedMessages = normalizeInterruptedMessages(savedMessages);
      for (const message of normalizedMessages) {
        if (message.status !== savedMessages.find((item) => item.id === message.id)?.status) {
          await put('messages', { ...message, updatedAt: now() });
        }
      }
      setMessages(normalizedMessages);
      setActiveSessionId(savedSessions[0]?.id ?? '');
      setReady(true);
    }
    boot().catch((err) => setError(`IndexedDB 初始化失败：${err.message}`));
  }, []);

  useEffect(() => connectStatusSocket((event) => {
    if (event.type === 'status') setWsStatus(event.status);
    if (event.type === 'notice') setNotice(event.message);
  }), []);

  useEffect(() => {
    const query = assetQuery.trim();
    assetSearchAbortRef.current?.abort();
    setActiveAssetIndex(-1);
    if (query.length < 3) {
      setAssetResults([]);
      setAssetSearchState('idle');
      return undefined;
    }

    const timeoutId = window.setTimeout(async () => {
      assetSearchAbortRef.current = new AbortController();
      setAssetSearchState('loading');
      try {
        const results = await searchAssets(assetQuery, assetSearchAbortRef.current.signal);
        setAssetResults(results);
        setAssetSearchState(results.length ? 'results' : 'empty');
      } catch (err) {
        if (err.name !== 'AbortError') {
          setAssetResults([]);
          setAssetSearchState('error');
        }
      }
    }, 250);

    return () => {
      window.clearTimeout(timeoutId);
      assetSearchAbortRef.current?.abort();
    };
  }, [assetQuery]);

  useEffect(() => {
    const retry = () => retryOfflineQueue();
    window.addEventListener('online', retry);
    return () => window.removeEventListener('online', retry);
  });

  async function login(name) {
    const nextUser = { id: 'local-user', name, updatedAt: now() };
    await put('users', nextUser);
    setUser(nextUser);
  }

  async function logout() {
    setUser(null);
  }

  async function createSession() {
    const session = { id: id('session'), title: '新会话', createdAt: now(), updatedAt: now() };
    await put('sessions', session);
    setSessions((prev) => [session, ...prev]);
    setActiveSessionId(session.id);
  }

  async function deleteSession(sessionId) {
    await remove('sessions', sessionId);
    const remainingSessions = sessions.filter((session) => session.id !== sessionId);
    const remainingMessages = messages.filter((message) => message.sessionId !== sessionId);
    for (const message of messages.filter((item) => item.sessionId === sessionId)) await remove('messages', message.id);
    setSessions(remainingSessions);
    setMessages(remainingMessages);
    setActiveSessionId(remainingSessions[0]?.id ?? '');
  }

  async function updateSessionTitle(sessionId, title) {
    const session = sessions.find((item) => item.id === sessionId);
    if (!session || session.title !== '新会话') return;
    const updated = { ...session, title: title.slice(0, 20), updatedAt: now() };
    await put('sessions', updated);
    setSessions((prev) => prev.map((item) => (item.id === sessionId ? updated : item)));
  }

  async function send(content, queuedId) {
    setError('');
    const sessionId = activeSessionId || (await createFirstSession());
    const userMessage = { id: queuedId || id('msg'), sessionId, role: 'user', content, status: 'done', createdAt: now(), updatedAt: now() };
    const assistantMessage = { id: id('msg'), sessionId, role: 'assistant', content: '', status: 'streaming', toolEvents: [], createdAt: now(), updatedAt: now() };

    await put('messages', userMessage);
    await put('messages', assistantMessage);
    setMessages((prev) => [...prev.filter((item) => item.id !== userMessage.id), userMessage, assistantMessage]);
    await updateSessionTitle(sessionId, content);

    if (!navigator.onLine) {
      await enqueueOffline(userMessage);
      const queuedAssistant = { ...assistantMessage, status: 'queued', content: '离线中，已加入待重试队列。', updatedAt: now() };
      await put('messages', queuedAssistant);
      setMessages((prev) => prev.map((item) => (item.id === assistantMessage.id ? queuedAssistant : item)));
      return;
    }

    abortRef.current = new AbortController();
    setStreaming(true);
    let assistantToolEvents = [];

    try {
      const financialContext = financialMode
        ? { role: 'system', content: `金融工作台：${financialTab}；当前资产：${financialSymbol}。仅基于工具结果陈述市场数据或事件。` }
        : null;
      const payload = buildModelMessages([systemPrompt, financialContext, ...activeMessages, userMessage].filter(Boolean), 6000);
      let assistantText = '';
      function appendToolEvent(event) {
        assistantToolEvents = [...assistantToolEvents, event];
        setMessages((prev) => prev.map((item) => (
          item.id === assistantMessage.id
            ? { ...item, toolEvents: [...(item.toolEvents ?? []), event], updatedAt: now() }
            : item
        )));
      }
      await streamChat(payload, abortRef.current.signal, {
        onTool(event) {
          appendToolEvent(event);
        },
        onToolResult(event) {
          appendToolEvent(event);
        },
        onReasoning() {
          setMessages((prev) => prev.map((item) => (
            item.id === assistantMessage.id && !item.content ? { ...item, content: '思考中...', updatedAt: now() } : item
          )));
        },
        onDelta(delta) {
          assistantText += delta;
          setMessages((prev) => prev.map((item) => (
            item.id === assistantMessage.id ? { ...item, content: assistantText, updatedAt: now() } : item
          )));
        },
        onDone() {}
      });
      await put('messages', { ...assistantMessage, content: assistantText, status: 'done', toolEvents: assistantToolEvents, updatedAt: now() });
      setMessages((prev) => prev.map((item) => (item.id === assistantMessage.id ? { ...item, status: 'done' } : item)));
    } catch (err) {
      if (err.name === 'AbortError') {
        let stoppedAssistant;
        setMessages((prev) => prev.map((item) => {
          if (item.id !== assistantMessage.id) return item;
          stoppedAssistant = { ...item, status: 'stopped', content: item.content || '已停止生成。', updatedAt: now() };
          return stoppedAssistant;
        }));
        await put('messages', stoppedAssistant || { ...assistantMessage, status: 'stopped', content: '已停止生成。', toolEvents: assistantToolEvents, updatedAt: now() });
      } else {
        await enqueueOffline(userMessage);
        setError(err.message);
        const failedAssistant = { ...assistantMessage, status: 'error', content: `请求失败：${err.message}`, updatedAt: now() };
        failedAssistant.toolEvents = assistantToolEvents;
        await put('messages', failedAssistant);
        setMessages((prev) => prev.map((item) => (item.id === assistantMessage.id ? failedAssistant : item)));
      }
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  }

  async function createFirstSession() {
    const session = { id: id('session'), title: '新会话', createdAt: now(), updatedAt: now() };
    await put('sessions', session);
    setSessions((prev) => [session, ...prev]);
    setActiveSessionId(session.id);
    return session.id;
  }

  async function enqueueOffline(message) {
    await put('offlineQueue', { ...message, queuedAt: now() });
  }

  async function retryOfflineQueue() {
    const queue = await getAll('offlineQueue');
    for (const item of queue) {
      await remove('offlineQueue', item.id);
      await send(item.content, item.id);
    }
  }

  async function clearAll() {
    await Promise.all(['sessions', 'messages', 'offlineQueue'].map((store) => clear(store)));
    setSessions([]);
    setMessages([]);
    setActiveSessionId('');
  }

  function stop() {
    abortRef.current?.abort();
  }

  function selectAsset(result) {
    setFinancialSymbol(result.symbol);
    setAssetQuery(result.symbol);
    setAssetResults([]);
    setAssetSearchState('idle');
    setActiveAssetIndex(-1);
    setAssetSearchOpen(false);
    researchContextRef.current?.focus();
  }

  function handleAssetSearchKeyDown(event) {
    if (!assetSearchOpen || !assetResults.length) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const direction = event.key === 'ArrowDown' ? 1 : -1;
      setActiveAssetIndex((index) => (index + direction + assetResults.length) % assetResults.length);
    }
    if (event.key === 'Enter' && activeAssetIndex >= 0) {
      event.preventDefault();
      selectAsset(assetResults[activeAssetIndex]);
    }
    if (event.key === 'Escape') {
      setAssetResults([]);
      setAssetSearchState('idle');
      setActiveAssetIndex(-1);
      setAssetSearchOpen(false);
    }
  }

  if (!ready) return <main className="loading">Loading...</main>;
  if (!user) return <Login onLogin={login} />;

  return (
    <main className="app-shell">
      <Sidebar
        user={user}
        sessions={sessions}
        activeSessionId={activeSessionId}
        financialMode={financialMode}
        onFinancialMode={() => setFinancialMode((active) => !active)}
        onCreate={createSession}
        onSelect={setActiveSessionId}
        onDelete={deleteSession}
        onLogout={logout}
        onClear={clearAll}
      />
      <section className="workspace">
        <StatusBar wsStatus={wsStatus} notice={notice} error={error} online={navigator.onLine} />
        {financialMode ? (
          <div className="financial-mode-layout">
            <header className="financial-workbench-bar">
              <div className="financial-workbench-brand">
                <span aria-hidden="true">FT</span>
                <div>
                  <p className="eyebrow">Financial terminal</p>
                  <strong>研究工作台</strong>
                </div>
              </div>
              <label className="financial-symbol-search">
                <span>资产搜索</span>
                <input
                  aria-label="搜索研究资产"
                  aria-activedescendant={activeAssetIndex >= 0 ? `asset-result-${activeAssetIndex}` : undefined}
                  aria-autocomplete="list"
                  aria-controls="asset-search-results"
                  aria-expanded={assetSearchOpen && assetResults.length > 0}
                  onBlur={() => setAssetSearchOpen(false)}
                  onChange={(event) => setAssetQuery(event.target.value)}
                  onFocus={() => setAssetSearchOpen(true)}
                  onKeyDown={handleAssetSearchKeyDown}
                  role="combobox"
                  type="search"
                  value={assetQuery}
                />
                {assetSearchOpen && assetResults.length > 0 && (
                  <ul className="asset-search-results" id="asset-search-results" role="listbox" aria-label="资产搜索结果">
                    {assetResults.map((result, index) => (
                      <li key={`${result.symbol}-${index}`}>
                        <button
                          aria-selected={activeAssetIndex === index}
                          id={`asset-result-${index}`}
                          onClick={() => selectAsset(result)}
                          onMouseEnter={() => setActiveAssetIndex(index)}
                          onMouseDown={(event) => event.preventDefault()}
                          role="option"
                          type="button"
                        >
                          <strong>{result.name}</strong><span>{result.symbol} · {result.market}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                <p aria-live="polite" className="financial-search-status">
                  {assetSearchState === 'loading' && '正在搜索资产…'}
                  {assetSearchState === 'empty' && '未找到匹配资产。'}
                  {assetSearchState === 'error' && '资产搜索暂不可用。'}
                  {assetSearchState === 'idle' && assetQuery.trim().length < 3 && '输入至少 3 个字符以搜索资产。'}
                </p>
              </label>
              <div className="financial-mode-indicator">
                <span>模式</span>
                <strong>研究</strong>
              </div>
            </header>
            <FinancialWorkspace
              activeTab={financialTab}
              onOpenChat={() => document.querySelector('[aria-label="金融对话输入"]')?.focus()}
              onSymbolChange={setFinancialSymbol}
              onTabChange={setFinancialTab}
              researchContextRef={researchContextRef}
              symbol={financialSymbol}
            />
            <ChatWindow
              financialMode={financialMode}
              financialSymbol={financialSymbol}
              messages={activeMessages}
              streaming={streaming}
              onSend={send}
              onStop={stop}
            />
          </div>
        ) : (
          <ChatWindow messages={activeMessages} streaming={streaming} financialMode={financialMode} onSend={send} onStop={stop} />
        )}
      </section>
    </main>
  );
}
