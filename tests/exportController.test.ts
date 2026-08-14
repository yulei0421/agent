import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { ExportController } from '../server/api/export/export.controller.js';
import type { ResearchExportService } from '../server/application/export/research-export.service.js';
import { AppError } from '../server/domain/errors/app-error.js';
import type { AppLoggerService } from '../server/infrastructure/logging/app-logger.service.js';

const report = { title: 'AAPL 研究摘要', conclusion: '结论', evidence: [], risks: [] };
const logger = { info() {}, error() {} } as unknown as AppLoggerService;

class FakeResponse extends EventEmitter {
  readonly headers = new Map<string, string>();
  statusCode: number | undefined;
  body: Buffer | undefined;
  writableEnded = false;

  status(code: number): this { this.statusCode = code; return this; }
  setHeader(name: string, value: string): this { this.headers.set(name, value); return this; }
  end(value?: Buffer): this { this.body = value; this.writableEnded = true; return this; }
  json(value: unknown): this { this.body = Buffer.from(JSON.stringify(value)); this.writableEnded = true; return this; }
}

test('streams a server-owned PDF download with exact content headers', async () => {
  const service = {
    async export(input: unknown) {
      assert.deepEqual(input, { report, format: 'pdf' });
      return { body: Buffer.from('%PDF-sample'), extension: 'pdf' as const, mediaType: 'application/pdf' as const };
    }
  } as unknown as ResearchExportService;
  const controller = new ExportController(service, logger);
  const response = new FakeResponse();

  await controller.export('pdf', response as never, { report }, { requestId: 'request_123' } as never);

  assert.equal(response.statusCode, 200);
  assert.equal(response.headers.get('Content-Type'), 'application/pdf');
  assert.equal(response.headers.get('Content-Length'), String(Buffer.byteLength('%PDF-sample')));
  assert.match(response.headers.get('Content-Disposition') ?? '', /^attachment; filename="financial-research-\d{8}T\d{6}Z\.pdf"$/);
  assert.equal(response.body?.toString(), '%PDF-sample');
});

test('returns only the public invalid request error for malformed export input', async () => {
  const service = { async export() { throw new AppError('invalid_request'); } } as unknown as ResearchExportService;
  const controller = new ExportController(service, logger);
  const response = new FakeResponse();

  await controller.export('docx', response as never, { report }, { requestId: 'request_123' } as never);

  assert.equal(response.statusCode, 400);
  assert.deepEqual(JSON.parse(response.body?.toString() ?? ''), { errorCode: 'invalid_request' });
});
