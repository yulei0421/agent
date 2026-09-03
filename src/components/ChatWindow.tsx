import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { LoaderCircle, Paperclip, Send, ShieldCheck, Square, X } from 'lucide-react';
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
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [content, setContent] = useState('');
  const [attachment, setAttachment] = useState<TextAttachment | ChatDocument | null>(null);
  const [attachmentLoading, setAttachmentLoading] = useState(false);
  const [attachmentError, setAttachmentError] = useState('');
  const [attachmentAnnouncement, setAttachmentAnnouncement] = useState('');
  const placeholder = financialMode
    ? '输入金融问题和显式代码，例如 600519.SH、0700.HK、AAPL、BTC/USDT'
    : '问 DeepSeek 一个问题...';

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = '0px';
    textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`;
    textarea.style.overflowY = textarea.scrollHeight > 200 ? 'auto' : 'hidden';
  }, [content]);

  async function handleAttachmentChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    setAttachmentAnnouncement('');
    setAttachmentError('');
    if (!file) return;
    setAttachmentLoading(true);
    try {
      const isText = /\.(?:txt|md|markdown|csv|json)$/iu.test(file.name);
      if (isText) {
        const next = normalizeTextAttachment(file.name, await file.text());
        if (!next) {
          setAttachmentError('仅支持非空 TXT、MD、CSV、JSON 文件，且内容不超过 3500 个字符。');
          return;
        }
        setAttachment(next);
        setAttachmentAnnouncement(`已添加附件 ${next.name}`);
        return;
      }
      const next = await ingestBinaryAttachment(file);
      setAttachment(next);
      setAttachmentAnnouncement(`已添加附件 ${next.name}`);
    } catch (error) {
      setAttachmentError(error instanceof Error ? error.message : '附件解析失败');
    } finally {
      setAttachmentLoading(false);
    }
  }

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
        setAttachmentAnnouncement('');
        onSend(value, undefined, documents);
      }}>
        <textarea
          aria-label={financialMode ? '金融对话输入' : '聊天输入'}
          ref={textareaRef}
          rows={1}
          value={content}
          onChange={(event) => setContent(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
            event.preventDefault();
            event.currentTarget.form?.requestSubmit();
          }}
          placeholder={placeholder}
        />
        <span aria-atomic="true" aria-live="polite" className="sr-only">
          {attachmentLoading ? '正在解析附件' : attachmentAnnouncement}
        </span>
        {(attachmentLoading || attachment || attachmentError) && (
          <div className="composer-status-row">
            {attachmentLoading && (
              <span className="attachment-loading">
                <LoaderCircle aria-hidden="true" />
                正在解析附件
              </span>
            )}
            {attachment && !attachmentLoading && (
              <span className="attachment-chip" title={attachment.name}>
                <span>{attachment.name}</span>
                <button
                  aria-label={`移除附件 ${attachment.name}`}
                  title={`移除附件 ${attachment.name}`}
                  disabled={streaming}
                  onClick={() => {
                    setAttachment(null);
                    setAttachmentAnnouncement('');
                  }}
                  type="button"
                >
                  <X aria-hidden="true" />
                </button>
              </span>
            )}
            {attachmentError && <span className="attachment-error" role="alert">{attachmentError}</span>}
          </div>
        )}
        <div className="composer-toolbar">
          <div className="composer-tools">
            <label
              aria-disabled={streaming || attachmentLoading}
              className="composer-icon-button attachment-picker"
              title="添加文本附件、PDF 或图片"
            >
              <Paperclip aria-hidden="true" />
              <span className="sr-only">添加附件</span>
              <input
                accept=".txt,.md,.csv,.json,.pdf,.png,.jpg,.jpeg,.webp,text/plain,text/markdown,text/csv,application/json,application/pdf,image/png,image/jpeg,image/webp"
                aria-label="添加附件"
                disabled={streaming || attachmentLoading}
                onChange={handleAttachmentChange}
                type="file"
              />
            </label>
            <button
              aria-label={approvalMode ? '关闭人工审批' : '开启人工审批'}
              aria-pressed={approvalMode}
              disabled={streaming}
              onClick={() => onReviewModeChange(!approvalMode)}
              type="button"
              className="composer-tool-button"
              title="执行工具前会等待批准"
            >
              <ShieldCheck aria-hidden="true" />
              <span>审批</span>
            </button>
          </div>
          {streaming ? (
            <button
              aria-label="停止生成"
              className="composer-submit stop"
              onClick={onStop}
              title="停止生成"
              type="button"
            >
              <Square aria-hidden="true" />
            </button>
          ) : (
            <button
              aria-label="发送消息"
              className="composer-submit"
              disabled={attachmentLoading || !content.trim()}
              title="发送消息"
              type="submit"
            >
              <Send aria-hidden="true" />
            </button>
          )}
        </div>
      </form>
    </section>
  );
}
