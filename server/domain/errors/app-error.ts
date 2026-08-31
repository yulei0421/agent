export type AppErrorCode =
  | 'approval_expired'
  | 'approval_not_found'
  | 'invalid_request'
  | 'not_found'
  | 'request_aborted'
  | 'tool_unavailable'
  | 'document_ocr_unavailable'
  | 'provider_unavailable'
  | 'model_unavailable'
  | 'internal_error';

const STATUS_BY_CODE: Readonly<Record<AppErrorCode, number>> = Object.freeze({
  approval_expired: 410,
  approval_not_found: 404,
  invalid_request: 400,
  not_found: 404,
  request_aborted: 499,
  tool_unavailable: 503,
  document_ocr_unavailable: 503,
  provider_unavailable: 503,
  model_unavailable: 502,
  internal_error: 500
});

export class AppError extends Error {
  constructor(readonly code: AppErrorCode, message: string = code) {
    super(message);
    this.name = 'AppError';
  }
}

export function toPublicError(error: unknown): { status: number; body: { errorCode: AppErrorCode } } {
  const code = error instanceof AppError ? error.code : 'internal_error';
  return { status: STATUS_BY_CODE[code], body: { errorCode: code } };
}
