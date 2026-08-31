import type { ResearchReport } from './research-report.js';

export type ResearchDocumentFormat = 'pdf' | 'pptx';

export interface ResearchDownloadLink {
  downloadUrl: string;
  filename: string;
  expiresAt: string;
  format: ResearchDocumentFormat;
}

export async function createResearchDownloadLink(report: ResearchReport, format: ResearchDocumentFormat): Promise<ResearchDownloadLink> {
  const response = await fetch(`/api/exports/research/${format}/link`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ report })
  });
  if (!response.ok) {
    const error = await response.json().catch((): { errorCode?: unknown } => ({})) as { errorCode?: unknown };
    throw new Error(typeof error.errorCode === 'string' ? error.errorCode : `导出失败：${response.status}`);
  }
  const linkPayload = await response.json().catch((): Partial<ResearchDownloadLink> => ({})) as Partial<ResearchDownloadLink>;
  if (typeof linkPayload.downloadUrl !== 'string' || !/^\/api\/exports\/research\/download\/[A-Za-z0-9_-]{32,128}$/u.test(linkPayload.downloadUrl)) {
    throw new Error('导出链接无效');
  }
  if (typeof linkPayload.filename !== 'string' || typeof linkPayload.expiresAt !== 'string' || linkPayload.format !== format) {
    throw new Error('导出链接无效');
  }
  return {
    downloadUrl: linkPayload.downloadUrl,
    filename: linkPayload.filename,
    expiresAt: linkPayload.expiresAt,
    format: linkPayload.format
  };
}

export async function downloadResearchReport(report: ResearchReport, format: ResearchDocumentFormat): Promise<void> {
  const linkPayload = await createResearchDownloadLink(report, format);
  const link = document.createElement('a');
  link.href = linkPayload.downloadUrl;
  link.download = linkPayload.filename;
  link.click();
  link.remove();
}
