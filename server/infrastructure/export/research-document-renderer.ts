import { existsSync } from 'node:fs';
import PDFDocument from 'pdfkit';
import PptxGenJSModule from 'pptxgenjs';
import { AppError } from '../../domain/errors/app-error.js';
import type { RenderedResearchDocument, ResearchDocumentRenderer as ResearchDocumentRendererPort, ResearchExportFormat } from '../../application/export/research-export.service.js';
import type { ResearchReport } from '../../../shared/research-report.js';

const PDF_MEDIA_TYPE = 'application/pdf' as const;
const PPTX_MEDIA_TYPE = 'application/vnd.openxmlformats-officedocument.presentationml.presentation' as const;
const DEFAULT_CJK_FONT = '/System/Library/Fonts/Supplemental/Arial Unicode.ttf';
const PptxGenJS = PptxGenJSModule.default;

export interface ResearchDocumentRendererOptions {
  fontPath?: string;
}

function asLines(items: readonly string[]): string {
  return items.map((item, index) => `${index + 1}. ${item}`).join('\n');
}

function createPdf(report: ResearchReport, fontPath: string): Promise<Buffer> {
  if (!existsSync(fontPath)) throw new AppError('internal_error');
  const document = new PDFDocument({ size: 'A4', margin: 56, info: { Title: report.title, Author: 'DeepSeek 金融 AI Agent Demo' } });
  const chunks: Buffer[] = [];
  document.on('data', (chunk: Buffer) => chunks.push(chunk));
  const finished = new Promise<Buffer>((resolve, reject) => {
    document.once('end', () => resolve(Buffer.concat(chunks)));
    document.once('error', () => reject(new AppError('internal_error')));
  });
  try {
    document.font(fontPath).fillColor('#17362d');
    document.fontSize(22).text(report.title);
    document.moveDown(0.3).fontSize(9).fillColor('#55736a').text(`数据时间：${report.asOf ?? '未提供'}`);
    document.moveDown(1).fontSize(14).fillColor('#17362d').text('结论');
    document.moveDown(0.25).fontSize(11).fillColor('#263833').text(report.conclusion, { lineGap: 4 });
    document.moveDown(1).fontSize(14).fillColor('#17362d').text('依据');
    document.moveDown(0.25).fontSize(10).fillColor('#263833').text(asLines(report.evidence.map((item) => `${item.claim} · ${item.source}${item.observedAt ? ` · ${item.observedAt}` : ''}`)), { lineGap: 4 });
    document.moveDown(1).fontSize(14).fillColor('#17362d').text('风险提示');
    document.moveDown(0.25).fontSize(10).fillColor('#263833').text(asLines(report.risks), { lineGap: 4 });
    document.moveDown(2).fontSize(8).fillColor('#55736a').text('仅供研究与学习参考，不构成投资建议。');
    document.end();
  } catch {
    document.destroy();
    throw new AppError('internal_error');
  }
  return finished;
}

async function createPptx(report: ResearchReport): Promise<Buffer> {
  const presentation = new PptxGenJS();
  presentation.layout = 'LAYOUT_WIDE';
  presentation.author = 'DeepSeek 金融 AI Agent Demo';
  presentation.subject = '金融研究报告';
  presentation.title = report.title;
  presentation.company = 'DeepSeek 金融 AI Agent Demo';
  presentation.theme = {
    headFontFace: 'Hiragino Sans GB', bodyFontFace: 'Hiragino Sans GB'
  };
  const theme = { ink: '17362D', muted: '55736A', accent: '0B7667', paper: 'F7FBF7', risk: '9E3528' };
  const addFooter = (slide: ReturnType<typeof presentation.addSlide>, number: number) => {
    slide.addText(`金融研究报告 · ${number}/3`, { x: 0.55, y: 7.08, w: 3, h: 0.2, fontFace: 'Hiragino Sans GB', fontSize: 9, color: theme.muted, margin: 0 });
  };
  const titleSlide = presentation.addSlide();
  titleSlide.background = { color: theme.paper };
  titleSlide.addShape(presentation.ShapeType.rect, { x: 0, y: 0, w: 13.333, h: 0.18, fill: { color: theme.accent }, line: { color: theme.accent } });
  titleSlide.addText(report.title, { x: 0.7, y: 0.85, w: 11.7, h: 0.75, fontFace: 'Hiragino Sans GB', fontSize: 32, bold: true, color: theme.ink, margin: 0, breakLine: false, fit: 'shrink' });
  titleSlide.addText('研究结论', { x: 0.72, y: 2.1, w: 2, h: 0.35, fontFace: 'Hiragino Sans GB', fontSize: 16, bold: true, color: theme.accent, margin: 0 });
  titleSlide.addText(report.conclusion, { x: 0.72, y: 2.58, w: 11.6, h: 2.3, fontFace: 'Hiragino Sans GB', fontSize: 22, color: theme.ink, breakLine: false, fit: 'shrink', valign: 'middle', margin: 0.08 });
  titleSlide.addText(`数据时间：${report.asOf ?? '未提供'}`, { x: 0.72, y: 6.5, w: 6, h: 0.28, fontFace: 'Hiragino Sans GB', fontSize: 12, color: theme.muted, margin: 0 });
  addFooter(titleSlide, 1);

  const evidenceSlide = presentation.addSlide();
  evidenceSlide.background = { color: 'FFFFFF' };
  evidenceSlide.addText('研究依据', { x: 0.7, y: 0.55, w: 6, h: 0.5, fontFace: 'Hiragino Sans GB', fontSize: 28, bold: true, color: theme.ink, margin: 0 });
  evidenceSlide.addText(report.evidence.map((item) => ({ text: `${item.claim}\n`, options: { bullet: { indent: 18 }, hanging: 3, breakLine: false } })), { x: 0.85, y: 1.5, w: 11.4, h: 3.35, fontFace: 'Hiragino Sans GB', fontSize: 20, color: theme.ink, breakLine: false, fit: 'shrink', paraSpaceAfter: 16, margin: 0.06 });
  evidenceSlide.addText(report.evidence.map((item) => `${item.source}${item.observedAt ? ` · ${item.observedAt}` : ''}`).join('\n'), { x: 1.12, y: 5.25, w: 10.9, h: 0.85, fontFace: 'Hiragino Sans GB', fontSize: 12, color: theme.muted, breakLine: false, fit: 'shrink', margin: 0 });
  addFooter(evidenceSlide, 2);

  const riskSlide = presentation.addSlide();
  riskSlide.background = { color: 'FFF9F7' };
  riskSlide.addText('风险与使用边界', { x: 0.7, y: 0.55, w: 7, h: 0.5, fontFace: 'Hiragino Sans GB', fontSize: 28, bold: true, color: theme.ink, margin: 0 });
  riskSlide.addText(report.risks.map((risk) => ({ text: `${risk}\n`, options: { bullet: { indent: 18 }, hanging: 3, breakLine: false } })), { x: 0.85, y: 1.5, w: 11.4, h: 3.3, fontFace: 'Hiragino Sans GB', fontSize: 22, color: theme.risk, breakLine: false, fit: 'shrink', paraSpaceAfter: 16, margin: 0.06 });
  riskSlide.addText('外部数据可能延迟、缺失或发生变化；本报告仅供研究与学习参考，不构成投资建议。', { x: 0.85, y: 5.85, w: 11, h: 0.45, fontFace: 'Hiragino Sans GB', fontSize: 14, color: theme.muted, margin: 0, fit: 'shrink' });
  addFooter(riskSlide, 3);
  return Buffer.from(await presentation.write({ outputType: 'nodebuffer' }) as ArrayBuffer);
}

export class ResearchDocumentRenderer implements ResearchDocumentRendererPort {
  private readonly fontPath: string;

  constructor(options: ResearchDocumentRendererOptions = {}) {
    this.fontPath = options.fontPath ?? DEFAULT_CJK_FONT;
  }

  async render(input: { report: ResearchReport; format: ResearchExportFormat }): Promise<RenderedResearchDocument> {
    if (input.format === 'pdf') return { body: await createPdf(input.report, this.fontPath), extension: 'pdf', mediaType: PDF_MEDIA_TYPE };
    return { body: await createPptx(input.report), extension: 'pptx', mediaType: PPTX_MEDIA_TYPE };
  }
}
