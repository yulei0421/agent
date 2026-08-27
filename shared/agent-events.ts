export type AgentPlanStepStatus = 'pending' | 'in_progress' | 'completed';

export interface AgentPlanStep {
  title: string;
  status: AgentPlanStepStatus;
}

export interface AgentPlanSnapshot {
  steps: readonly AgentPlanStep[];
  currentStep: number;
  completed: boolean;
}

export type AgentRole = 'researcher' | 'risk_reviewer';
export type AgentRunStatus = 'started' | 'completed' | 'failed';

export interface AgentCollaborationEvent {
  type: 'agent';
  role: AgentRole;
  status: AgentRunStatus;
}
