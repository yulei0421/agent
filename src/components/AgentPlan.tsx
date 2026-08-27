import type { AgentPlanSnapshot } from '../../shared/agent-events.js';

export function AgentPlan({ plan }: { plan: AgentPlanSnapshot | undefined }) {
  if (!plan || plan.steps.length === 0) return null;

  return (
    <section className="agent-plan" aria-label="任务计划">
      <div className="agent-plan-heading">
        <h3>任务计划</h3>
        <span>{plan.completed ? '已完成' : `执行 ${Math.min(plan.currentStep + 1, plan.steps.length)}/${plan.steps.length}`}</span>
      </div>
      <ol>
        {plan.steps.map((step, index) => (
          <li className={`agent-plan-step ${step.status}`} key={`${step.title}-${index}`}>
            <span className="agent-plan-marker" aria-hidden="true">{step.status === 'completed' ? '✓' : index + 1}</span>
            <span>{step.title}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
