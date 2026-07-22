import type { ToolExecutor } from '../../domain/tools/tool.types.js';
import { createToolRegistry } from '../../tools/registry.js';

export type ToolRegistryExecutorDependencies = NonNullable<Parameters<typeof createToolRegistry>[0]>;

export function createToolRegistryExecutor(dependencies?: ToolRegistryExecutorDependencies): ToolExecutor {
  const registry = createToolRegistry(dependencies);

  return {
    definitions: registry.definitions,
    execute: registry.execute
  };
}
