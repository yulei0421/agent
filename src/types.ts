import type { StreamEvent } from './lib/chat.js';

export type FinancialTab = 'markets' | 'events' | 'trader' | 'watchlist' | 'alerts';
export type MessageStatus = 'done' | 'streaming' | 'queued' | 'stopped' | 'error';
export type ToolEvent = Extract<StreamEvent, { type: 'tool' | 'tool_result' }>;

export interface LocalUser {
  id: string;
  name: string;
  updatedAt: string;
}

export interface Session {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

export interface ChatRecord {
  id: string;
  sessionId: string;
  role: 'user' | 'assistant';
  content: string;
  status: MessageStatus;
  createdAt: string;
  updatedAt: string;
  toolEvents?: ToolEvent[];
  queuedAt?: string;
}

export type WebSocketStatus = 'connecting' | 'connected' | 'reconnecting' | 'error';
export type AssetSearchState = 'idle' | 'loading' | 'results' | 'empty' | 'error';
