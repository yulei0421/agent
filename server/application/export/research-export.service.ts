import { AppError } from '../../domain/errors/app-error.js';
import { parseResearchReport, type ResearchReport } from '../../../shared/research-report.js';

export type ResearchExportFormat = 'pdf' | 'pptx';

export interface RenderedResearchDocument {
  body: Buffer;
  extension: ResearchExportFormat;
  mediaType: 'application/pdf' | 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
}

export interface ResearchDocumentRenderer {
  render(input: { report: ResearchReport; format: ResearchExportFormat }): Promise<RenderedResearchDocument>;
}

export class ResearchExportService {
  constructor(private readonly renderer: ResearchDocumentRenderer) {}

  async export(input: { report: unknown; format: unknown }): Promise<RenderedResearchDocument> {
    const report = parseResearchReport(input.report);
    if (!report || (input.format !== 'pdf' && input.format !== 'pptx')) throw new AppError('invalid_request');
    return this.renderer.render({ report, format: input.format });
  }
}
