import { Annotation } from '@langchain/langgraph';

export const AgentStateAnnotation = Annotation.Root({
  goal: Annotation<string>({ reducer: (_left, right) => right, default: () => '' }),
  plan: Annotation<string[]>({ reducer: (_left, right) => right, default: () => [] }),
  currentStep: Annotation<number>({ reducer: (_left, right) => right, default: () => 0 }),
  terminated: Annotation<boolean>({ reducer: (_left, right) => right, default: () => false })
});

export type AgentGraphState = typeof AgentStateAnnotation.State;
export type AgentGraphUpdate = typeof AgentStateAnnotation.Update;

export type Planner = (goal: string) => Promise<readonly string[]>;

export function normalizePlan(steps: readonly string[]): string[] {
  return steps
    .filter((step) => typeof step === 'string')
    .map((step) => step.trim())
    .filter((step) => step.length > 0 && step.length <= 120)
    .slice(0, 3);
}
