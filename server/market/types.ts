export interface FetchResponseLike {
  ok: boolean;
  status?: number;
  json?: () => Promise<unknown>;
  text?: () => Promise<string>;
}

export type FetchLike = (url: string, options?: RequestInit) => Promise<FetchResponseLike>;

export interface AssetSearchResult {
  symbol: string;
  name: string;
  market: string;
  type: string;
  source: string;
}

export type AssetSearchResponse = AssetSearchResult[] | { ok: false; errorCode: 'request_aborted' };
