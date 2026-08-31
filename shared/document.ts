export type TextDocumentMimeType = 'text/plain' | 'text/markdown' | 'text/csv' | 'application/json';
export type SourceDocumentMimeType = TextDocumentMimeType | 'application/pdf' | 'image/png' | 'image/jpeg' | 'image/webp';
export type ExtractedDocumentKind = 'text' | 'pdf' | 'image';

export interface ExtractedDocumentMetadata {
  readonly sourceMimeType?: Exclude<SourceDocumentMimeType, TextDocumentMimeType>;
  readonly sourceKind?: Exclude<ExtractedDocumentKind, 'text'>;
  readonly pageCount?: number;
  readonly ocrUsed?: boolean;
  readonly chunks?: readonly string[];
}

export interface ExtractedDocument extends ExtractedDocumentMetadata {
  readonly name: string;
  readonly mimeType: TextDocumentMimeType;
  readonly text: string;
}
