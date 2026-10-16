export interface RowPage<T> {
  data: T[] | null;
  count: number | null;
  error: { message: string } | null;
}

/** 完整读取或明确失败，避免把截断结果当作完整族谱。 */
export async function fetchAllRows<T extends { id: number }>(
  fetchPage: (from: number, to: number) => PromiseLike<RowPage<T>>
): Promise<{ data: T[]; error: string | null }> {
  let expectedCount: number | null = null;
  const rows: T[] = [];
  const seen = new Set<number>();
  const fail = (error: string) => ({ data: [], error });

  try {
    while (true) {
      // 调用方为每一页创建新查询，偏移量按实际返回数量推进。
      const page = await fetchPage(rows.length, rows.length + 499);
      if (page.error) return fail(`读取数据失败：${page.error.message}`);
      if (page.count === null || !Number.isInteger(page.count) || page.count < 0) {
        return fail("读取数据失败：缺少有效的记录总数");
      }
      if (!Array.isArray(page.data)) return fail("读取数据失败：未返回有效数据");
      if (expectedCount === null) expectedCount = page.count;
      if (page.count !== expectedCount) return fail("读取期间记录总数发生变化，请重试");
      if (rows.length + page.data.length > expectedCount) return fail("读取数据失败：记录数量超出总数");
      for (const row of page.data) {
        if (seen.has(row.id)) return fail("读取数据失败：发现重复记录，请重试");
        seen.add(row.id);
        rows.push(row);
      }
      if (rows.length === expectedCount) return { data: rows, error: null };
      if (page.data.length === 0) return fail("读取数据失败：数据尚未完整返回");
    }
  } catch (error) {
    return fail(`读取数据失败：${error instanceof Error ? error.message : "网络请求异常，请重试"}`);
  }
}
