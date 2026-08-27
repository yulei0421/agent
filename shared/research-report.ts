export interface ResearchEvidence {
  claim: string;
  source: string;
  observedAt?: string;
}

export interface ResearchReport {
  title: string;
  conclusion: string;
  evidence: readonly ResearchEvidence[];
  risks: readonly string[];
  asOf?: string;
}

export interface ResearchReportParseOptions {
  allowedSources?: readonly string[];
}

type UnknownRecord = Record<string, unknown>;

function isPlainObject(value: unknown): value is UnknownRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function boundedText(value: unknown, maximum: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > maximum) return undefined;
  // This stays browser-compatible because the same report contract runs in Vite.
  const hasIpv6 = /(?:^|[^\p{L}\p{N}])(?:[0-9A-Fa-f]{1,4}:){2,}[0-9A-Fa-f:.]*/u.test(normalized);
  return /(?:^|[^\p{L}\p{N}])[A-Za-z][A-Za-z0-9+.-]*:\/{1,2}\S/iu.test(normalized)
    || /(?:^|[^\p{L}\p{N}])(?:data|mailto|tel|urn|javascript):\S/iu.test(normalized)
    || /\bwww\./iu.test(normalized)
    || /\b\d{1,3}(?:\.\d{1,3}){3}\b/u.test(normalized)
    || hasIpv6
    ? undefined
    : normalized;
}

function isoTime(value: unknown): string | undefined {
  const text = boundedText(value, 40);
  return text && Number.isFinite(Date.parse(text)) ? text : undefined;
}

function parseValue(value: string | unknown): unknown {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
}

// Accept only the small presentation contract, never arbitrary model JSON.
export function parseResearchReport(value: string | unknown, options: ResearchReportParseOptions = {}): ResearchReport | null {
  const candidate = parseValue(value);
  if (!isPlainObject(candidate)) return null;
  const title = boundedText(candidate.title, 120);
  const conclusion = boundedText(candidate.conclusion, 2_000);
  const evidenceRows = Array.isArray(candidate.evidence) ? candidate.evidence : undefined;
  const riskRows = Array.isArray(candidate.risks) ? candidate.risks : undefined;
  if (!title || !conclusion || !evidenceRows || !riskRows || evidenceRows.length > 6 || riskRows.length > 6) return null;

  const evidence = evidenceRows.map((row): ResearchEvidence | null => {
    if (!isPlainObject(row)) return null;
    const claim = boundedText(row.claim, 500);
    const source = boundedText(row.source, 128);
    if (!claim || !source) return null;
    if (options.allowedSources && !options.allowedSources.includes(source)) return null;
    const observedAt = row.observedAt === undefined ? undefined : isoTime(row.observedAt);
    if (row.observedAt !== undefined && !observedAt) return null;
    return { claim, source, ...(observedAt ? { observedAt } : {}) };
  });
  if (evidence.some((row) => row === null)) return null;
  const risks = riskRows.map((risk) => boundedText(risk, 300));
  if (risks.some((risk) => !risk)) return null;
  const asOf = candidate.asOf === undefined ? undefined : isoTime(candidate.asOf);
  if (candidate.asOf !== undefined && !asOf) return null;
  return { title, conclusion, evidence: evidence as ResearchEvidence[], risks: risks as string[], ...(asOf ? { asOf } : {}) };
}
