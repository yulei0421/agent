import type { StreamEvent } from './lib/chat.js';
import type { ChatDocument } from './lib/attachments.js';
import type { ResearchCitation } from '../shared/research-citations.js';
import type { ResearchReport } from './lib/research-report.js';
import type { AgentCollaborationEvent, AgentPlanSnapshot } from '../shared/agent-events.js';

export type FinancialTab = 'markets' | 'events' | 'trader' | 'watchlist' | 'alerts';
export type MessageStatus = 'done' | 'streaming' | 'queued' | 'stopped' | 'error';
export type ToolEvent = Extract<StreamEvent, { type: 'tool' | 'tool_result' }>;
export type AgentEvent = AgentCollaborationEvent;
export type ApprovalEvent = Extract<StreamEvent, { type: 'approval' }>;

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
  memory?: string;
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
  agentEvents?: AgentEvent[];
  approval?: ApprovalEvent;
  researchReport?: ResearchReport;
  plan?: AgentPlanSnapshot;
  queuedAt?: string;
  documents?: ChatDocument[];
  citations?: readonly ResearchCitation[];
  taskId?: string;
}

export type WebSocketStatus = 'connecting' | 'connected' | 'reconnecting' | 'error';
export type AssetSearchState = 'idle' | 'loading' | 'results' | 'empty' | 'error';
