import { useState } from 'react';
import { MessageList } from './MessageList.js';
import { ingestBinaryAttachment, normalizeTextAttachment, toChatDocument, type ChatDocument, type TextAttachment } from '../lib/attachments.js';
import type { ChatRecord } from '../types.js';

interface ChatWindowProps {
  messages: readonly ChatRecord[];
  streaming: boolean;
  financialMode: boolean;
  financialSymbol?: string;
  approvalMode: boolean;
  onReviewModeChange(value: boolean): void;
  onSend(content: string, queuedId?: string, documents?: readonly ChatDocument[]): void | Promise<void>;
  onStop(): void;
  onRetry?(message: ChatRecord): void;
}

export function ChatWindow({ messages, streaming, financialMode, financialSymbol, approvalMode, onReviewModeChange, onSend, onStop, onRetry }: ChatWindowProps) {
  const [content, setContent] = useState('');
  const [attachment, setAttachment] = useState<TextAttachment | ChatDocument | null>(null);
  const [attachmentLoading, setAttachmentLoading] = useState(false);
  const [attachmentError, setAttachmentError] = useState('');
  const placeholder = financialMode
    ? '输入金融问题和显式代码，例如 600519.SH、0700.HK、AAPL、BTC/USDT'
    : '问 DeepSeek 一个问题...';

  return (
    <section className={financialMode ? 'chat financial-chat financial-chat-panel' : 'chat'}>
      {financialMode && (
        <header className="financial-context">
          <p className="eyebrow">Market context</p>
          <h1>Copilot 对话</h1>
          <p>当前资产：<strong>{financialSymbol ?? '未选择'}</strong>。输入明确的市场代码后，可在回答中查看本次查询的数据来源与工具调用记录。</p>
        </header>
      )}
      <MessageList messages={messages} streaming={streaming} onRetry={onRetry} />
      <form className="composer" onSubmit={(event) => {
        event.preventDefault();
        const value = content.trim();
        if (!value || streaming || attachmentLoading) return;
        setContent('');
        const documents = attachment ? ['content' in attachment ? toChatDocument(attachment) : attachment] : undefined;
        setAttachment(null);
        onSend(value, undefined, documents);
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
        <label className="approval-toggle">
          <input type="checkbox" checked={approvalMode} disabled={streaming} onChange={(event) => onReviewModeChange(event.target.checked)} />
          <span>人工审批工具调用</span>
          <small>开启后，执行工具前会暂停等待你的批准。</small>
        </label>
        <div className="composer-attachment">
          <label className="attachment-picker">
            <span>添加文本附件 / PDF / 图片</span>
            <input
              accept=".txt,.md,.csv,.json,.pdf,.png,.jpg,.jpeg,.webp,text/plain,text/markdown,text/csv,application/json,application/pdf,image/png,image/jpeg,image/webp"
              aria-label="添加聊天附件"
              disabled={streaming}
              onChange={async (event) => {
                const file = event.currentTarget.files?.[0];
                event.currentTarget.value = '';
                setAttachmentError('');
                if (!file) return;
                const isText = /\.(?:txt|md|markdown|csv|json)$/iu.test(file.name);
                if (isText) {
                  const next = normalizeTextAttachment(file.name, await file.text());
                  if (!next) {
                    setAttachmentError('仅支持非空 TXT、MD、CSV、JSON 文件，且内容不超过 3500 个字符。');
                    return;
                  }
                  setAttachment(next);
                  return;
                }
                setAttachmentLoading(true);
                try {
                  setAttachment(await ingestBinaryAttachment(file));
                } catch (error) {
                  setAttachmentError(error instanceof Error ? error.message : '附件解析失败');
                } finally {
                  setAttachmentLoading(false);
                }
              }}
              type="file"
            />
          </label>
          {attachmentLoading && <span className="attachment-loading">正在解析附件...</span>}
          {attachment && !attachmentLoading && (
            <button className="attachment-chip" type="button" onClick={() => setAttachment(null)} disabled={streaming}>
              {attachment.name} ×
            </button>
          )}
          {attachmentError && <span className="attachment-error" role="alert">{attachmentError}</span>}
        </div>
        <p className="composer-context-note">当前会话会保留有限本地工作记忆；历史文本附件会按问题在浏览器本地召回相关片段。</p>
        <div className="composer-actions">
          <button type="button" onClick={onStop} disabled={!streaming}>停止生成</button>
          <button type="submit" disabled={streaming || attachmentLoading || !content.trim()}>发送</button>
        </div>
      </form>
    </section>
  );
}
