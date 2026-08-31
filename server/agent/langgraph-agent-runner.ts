import { createOnlineAgentGraph, type OnlineAgentDependencies } from './graph.js';
import type { AgentRunRequest, AgentRunner, ModelClient, Planner, ToolExecutor } from '../application/chat/chat.ports.js';
import type { AgentSseEvent } from '../types.js';
import { ResearchCoordinator } from './research-coordinator.js';
import type { InMemoryApprovalCoordinator } from './approval-coordinator.js';

export interface LangGraphAgentRunnerDependencies {
  model: ModelClient;
  tools: ToolExecutor;
  planner?: Planner;
  coordinator?: ResearchCoordinator;
  approval?: InMemoryApprovalCoordinator;
}

export class LangGraphAgentRunner implements AgentRunner {
  private readonly graph: ReturnType<typeof createOnlineAgentGraph>;
  private readonly coordinator?: ResearchCoordinator;

  constructor(dependencies: LangGraphAgentRunnerDependencies) {
    const graphDependencies: OnlineAgentDependencies = {
      model: dependencies.model,
      tools: dependencies.tools,
      planner: dependencies.planner,
      approval: dependencies.approval
    };
    // The graph is immutable after compilation and safely isolates invocation state.
    this.graph = createOnlineAgentGraph(graphDependencies);
    this.coordinator = dependencies.coordinator;
  }

  async run(request: AgentRunRequest) {
    let messages = [...request.messages];
    let events: AgentSseEvent[] = [];
    if (request.collaboration === 'research' && this.coordinator) {
      const delegated = await this.coordinator.prepare({
        goal: request.goal,
        signal: request.signal,
        onEvent: request.onEvent
      });
      const firstNonSystem = messages.findIndex((message) => message.role !== 'system');
      const insertionPoint = firstNonSystem === -1 ? messages.length : firstNonSystem;
      messages = [
        ...messages.slice(0, insertionPoint),
        ...delegated.messages,
        ...messages.slice(insertionPoint)
      ];
      events = [...delegated.events];
    }
    const state = await this.graph.invoke({ ...request, messages, events, review: Boolean(request.review) });
    return state.events;
  }
}
