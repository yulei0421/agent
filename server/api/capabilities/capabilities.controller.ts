import { Controller, Get } from '@nestjs/common';
import { CapabilityRegistry } from '../../application/capabilities/capability.registry.js';

@Controller('api/capabilities')
export class CapabilitiesController {
  constructor(private readonly capabilities: CapabilityRegistry) {}

  @Get()
  list(): { capabilities: readonly ReturnType<CapabilityRegistry['publicSummary']>[number][] } {
    return { capabilities: this.capabilities.publicSummary() };
  }
}
