import { END, START, StateGraph } from '@langchain/langgraph';
import { AgentStateAnnotation, normalizePlan, type Planner } from './state.js';

export function createPlanningGraph(planner: Planner) {
  const planNode = async (state: typeof AgentStateAnnotation.State) => ({
    plan: normalizePlan(await planner(state.goal)),
    currentStep: 0,
    terminated: false
  });

  return new StateGraph(AgentStateAnnotation)
    .addNode('plan_request', planNode)
    .addEdge(START, 'plan_request')
    .addEdge('plan_request', END)
    .compile();
}
