import { Injectable } from '@nestjs/common';
import type { AgentRole } from '../../shared/agent-events.js';

export interface SubAgentDefinition {
  readonly role: AgentRole;
  readonly system: string;
  readonly maxItems: number;
  readonly timeoutMs: number;
  readonly maxConcurrent: number;
}

export interface PublicSubAgentDefinition {
  readonly role: AgentRole;
  readonly maxItems: number;
  readonly timeoutMs: number;
  readonly maxConcurrent: number;
}

const DEFAULT_DEFINITIONS: readonly SubAgentDefinition[] = [
  {
    role: 'researcher',
    system: 'You are the research delegate. Return only JSON {"items":["..."]}. List up to four data needs or comparison questions for the main agent. Do not state facts, sources, URLs, prices, or investment advice.',
    maxItems: 4,
    timeoutMs: 15_000,
    maxConcurrent: 1
  },
  {
    role: 'risk_reviewer',
    system: 'You are the risk reviewer delegate. Return only JSON {"items":["..."]}. List up to four checks for freshness, source consistency, uncertainty, or downside risks. Do not state facts, sources, URLs, prices, or investment advice.',
    maxItems: 4,
    timeoutMs: 15_000,
    maxConcurrent: 1
  }
];

function freezeDefinition(definition: SubAgentDefinition): SubAgentDefinition {
  return Object.freeze({ ...definition });
}

@Injectable()
export class SubAgentRegistry {
  private readonly definitions: readonly SubAgentDefinition[];

  constructor(definitions: readonly SubAgentDefinition[] = DEFAULT_DEFINITIONS) {
    const roles = new Set<AgentRole>();
    this.definitions = Object.freeze(definitions.map((definition) => {
      if (roles.has(definition.role)) throw new Error(`Duplicate sub-agent role: ${definition.role}`);
      if (!Number.isInteger(definition.maxItems) || definition.maxItems < 1 || definition.maxItems > 8) throw new Error('Sub-agent maxItems is out of range');
      if (!Number.isInteger(definition.timeoutMs) || definition.timeoutMs < 100 || definition.timeoutMs > 120_000) throw new Error('Sub-agent timeoutMs is out of range');
      if (!Number.isInteger(definition.maxConcurrent) || definition.maxConcurrent < 1 || definition.maxConcurrent > 4) throw new Error('Sub-agent maxConcurrent is out of range');
      roles.add(definition.role);
      return freezeDefinition(definition);
    }));
  }

  definitionsList(): readonly SubAgentDefinition[] {
    return this.definitions;
  }

  get(role: AgentRole): SubAgentDefinition | undefined {
    return this.definitions.find((definition) => definition.role === role);
  }

  roles(): readonly AgentRole[] {
    return this.definitions.map((definition) => definition.role);
  }

  publicSummary(): readonly PublicSubAgentDefinition[] {
    return Object.freeze(this.definitions.map(({ role, maxItems, timeoutMs, maxConcurrent }) => Object.freeze({ role, maxItems, timeoutMs, maxConcurrent })));
  }
}
