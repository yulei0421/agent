export async function searchAssets(query, signal) {
  const response = await fetch(`/api/market/search?${new URLSearchParams({ q: query })}`, { signal });
  if (response.status === 499) {
    const error = new Error('资产搜索已取消');
    error.name = 'AbortError';
    throw error;
  }
  if (!response.ok) {
    throw new Error(`资产搜索失败：${response.status}`);
  }

  const payload = await response.json();
  return Array.isArray(payload?.results) ? payload.results : [];
}
