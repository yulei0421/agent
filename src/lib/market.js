export async function searchAssets(query, signal) {
  const response = await fetch(`/api/market/search?${new URLSearchParams({ q: query })}`, { signal });
  if (!response.ok) {
    throw new Error(`资产搜索失败：${response.status}`);
  }

  const payload = await response.json();
  return Array.isArray(payload?.results) ? payload.results : [];
}
