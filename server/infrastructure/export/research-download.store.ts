import { randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { RenderedResearchDocument, ResearchExportFormat } from '../../application/export/research-export.service.js';

export interface ResearchDownloadArtifact {
  body: Buffer;
  extension: ResearchExportFormat;
  mediaType: RenderedResearchDocument['mediaType'];
  filename: string;
  expiresAt: number;
}

export interface ResearchDownloadLink {
  token: string;
  filename: string;
  expiresAt: number;
}

export interface ResearchDownloadStore {
  create(document: RenderedResearchDocument, filename: string, now?: number): ResearchDownloadLink;
  get(token: string, now?: number): ResearchDownloadArtifact | undefined;
}

interface StoredArtifact extends ResearchDownloadArtifact {
  createdAt: number;
}

@Injectable()
export class InMemoryResearchDownloadStore implements ResearchDownloadStore {
  private readonly entries = new Map<string, StoredArtifact>();
  private readonly ttlMs: number;
  private readonly maxEntries: number;

  constructor(options: { ttlMs?: number; maxEntries?: number } = {}) {
    this.ttlMs = options.ttlMs ?? 5 * 60_000;
    this.maxEntries = options.maxEntries ?? 100;
  }

  create(document: RenderedResearchDocument, filename: string, now = Date.now()): ResearchDownloadLink {
    this.prune(now);
    const token = randomBytes(32).toString('base64url');
    const expiresAt = now + this.ttlMs;
    while (this.entries.size >= this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (typeof oldest !== 'string') break;
      this.entries.delete(oldest);
    }
    this.entries.set(token, {
      body: Buffer.from(document.body),
      extension: document.extension,
      mediaType: document.mediaType,
      filename,
      expiresAt,
      createdAt: now
    });
    return { token, filename, expiresAt };
  }

  get(token: string, now = Date.now()): ResearchDownloadArtifact | undefined {
    if (!/^[A-Za-z0-9_-]{32,128}$/u.test(token)) return undefined;
    this.prune(now);
    const artifact = this.entries.get(token);
    if (!artifact || artifact.expiresAt <= now) {
      this.entries.delete(token);
      return undefined;
    }
    return {
      body: Buffer.from(artifact.body),
      extension: artifact.extension,
      mediaType: artifact.mediaType,
      filename: artifact.filename,
      expiresAt: artifact.expiresAt
    };
  }

  private prune(now: number): void {
    for (const [token, artifact] of this.entries) {
      if (artifact.expiresAt <= now) this.entries.delete(token);
    }
  }
}
