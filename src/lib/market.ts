export type AssetSearchResult = { symbol: string; name: string; market?: string; type?: string; source?: string };

export async function searchAssets(query: string, signal?: AbortSignal): Promise<AssetSearchResult[]> {
  const response = await fetch(`/api/market/search?${new URLSearchParams({ q: query })}`, { signal });
  if (response.status === 499) {
    const error = new Error('资产搜索已取消');
    error.name = 'AbortError';
    throw error;
  }
  if (!response.ok) {
    throw new Error(`资产搜索失败：${response.status}`);
  }

  const payload = await response.json() as unknown;
  if (!payload || typeof payload !== 'object' || !Array.isArray((payload as { results?: unknown }).results)) return [];
  return (payload as { results: unknown[] }).results.filter((result): result is AssetSearchResult => (
    Boolean(result)
    && typeof result === 'object'
    && typeof (result as { symbol?: unknown }).symbol === 'string'
    && typeof (result as { name?: unknown }).name === 'string'
  ));
}
