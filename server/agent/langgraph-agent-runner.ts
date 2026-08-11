import { createOnlineAgentGraph, type OnlineAgentDependencies } from './graph.js';
import type { AgentRunRequest, AgentRunner, ModelClient, Planner, ToolExecutor } from '../application/chat/chat.ports.js';

export interface LangGraphAgentRunnerDependencies {
  model: ModelClient;
  tools: ToolExecutor;
  planner?: Planner;
}

export class LangGraphAgentRunner implements AgentRunner {
  private readonly graph: ReturnType<typeof createOnlineAgentGraph>;

  constructor(dependencies: LangGraphAgentRunnerDependencies) {
    const graphDependencies: OnlineAgentDependencies = {
      model: dependencies.model,
      tools: dependencies.tools,
      planner: dependencies.planner
    };
    // The graph is immutable after compilation and safely isolates invocation state.
    this.graph = createOnlineAgentGraph(graphDependencies);
  }

  async run(request: AgentRunRequest) {
    const state = await this.graph.invoke({ ...request, messages: [...request.messages] });
    return state.events;
  }
}
