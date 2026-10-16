import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAllRows } from "@/lib/supabase/fetch-all-rows";

/** 限制每批 ID 数量，并核对每批姓名查询的完整性。 */
export async function fetchMemberNamesByIds(
  supabase: SupabaseClient,
  ids: number[]
): Promise<{ data: { id: number; name: string }[]; error: string | null }> {
  const uniqueIds = [...new Set(ids)];
  const names: { id: number; name: string }[] = [];
  for (let offset = 0; offset < uniqueIds.length; offset += 100) {
    const batch = uniqueIds.slice(offset, offset + 100);
    const result = await fetchAllRows<{ id: number; name: string }>((from, to) =>
      supabase.from("family_members")
        .select("id, name", { count: "exact" })
        .in("id", batch)
        .order("id", { ascending: true })
        .range(from, to)
    );
    if (result.error) return { data: [], error: result.error };
    names.push(...result.data);
  }
  return { data: names, error: null };
}
