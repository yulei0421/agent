import type { ResearchReport } from './research-report.js';

export type ResearchDocumentFormat = 'pdf' | 'pptx';

function filename(response: Response, fallback: string): string {
  const header = response.headers.get('Content-Disposition') ?? '';
  const match = /filename="([A-Za-z0-9._-]+)"/u.exec(header);
  return match?.[1] ?? fallback;
}

export async function downloadResearchReport(report: ResearchReport, format: ResearchDocumentFormat): Promise<void> {
  const response = await fetch(`/api/exports/research/${format}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ report })
  });
  if (!response.ok) {
    const error = await response.json().catch((): { errorCode?: unknown } => ({})) as { errorCode?: unknown };
    throw new Error(typeof error.errorCode === 'string' ? error.errorCode : `导出失败：${response.status}`);
  }
  const body = await response.blob();
  const url = URL.createObjectURL(body);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename(response, `financial-research.${format}`);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
