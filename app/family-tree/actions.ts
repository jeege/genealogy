"use server";

import { fetchAllRows } from "@/lib/supabase/fetch-all-rows";
import { fetchMemberNamesByIds } from "./member-queries";
import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import {
  importMemberKey,
  normalizeImportMembers,
  resolveImportFathers,
  type ImportFatherCandidate,
  type ImportFatherMatch,
  type ImportMemberInput,
} from "./member-import";

export type { ImportMemberInput } from "./member-import";

export interface FamilyMember {
  id: number;
  name: string;
  generation: number | null;
  sibling_order: number | null;
  father_id: number | null;
  father_name: string | null;
  gender: "男" | "女" | null;
  official_position: string | null;
  is_alive: boolean;
  spouse: string | null;
  remarks: string | null;
  birthday: string | null;
  death_date: string | null;
  residence_place: string | null;
  updated_at: string;
}

export interface FetchMembersResult {
  data: FamilyMember[];
  count: number;
  error: string | null;
}

export async function fetchFamilyMembers(
  page: number = 1,
  pageSize: number = 50,
  searchQuery: string = ""
): Promise<FetchMembersResult> {
  const supabase = await createClient();

  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  let query = supabase
    .from("family_members")
    .select("*", { count: "exact" });

  if (searchQuery.trim()) {
    query = query.ilike("name", `%${searchQuery.trim()}%`);
  }

  const { data, count, error } = await query
    .order("generation", { ascending: true })
    .order("sibling_order", { ascending: true })
    .order("id", { ascending: true })
    .range(from, to);

  if (error) {
    return { data: [], count: 0, error: error.message };
  }

  // 获取所有父亲 ID
  const fatherIds = (data || [])
    .map((item) => item.father_id)
    .filter((id): id is number => id !== null);

  const { data: fathers, error: fatherError } = await fetchMemberNamesByIds(supabase, fatherIds);
  if (fatherError) return { data: [], count: 0, error: fatherError };
  const fatherMap: Record<number, string> = Object.fromEntries(fathers.map((father) => [father.id, father.name]));

  // 转换数据格式，添加 father_name
  const transformedData: FamilyMember[] = (data || []).map((item) => ({
    ...item,
    father_name: item.father_id ? fatherMap[item.father_id] || null : null,
  }));

  return { data: transformedData, count: count || 0, error: null };
}

export interface CreateMemberInput {
  name: string;
  generation?: number | null;
  sibling_order?: number | null;
  father_id?: number | null;
  gender?: "男" | "女" | null;
  official_position?: string | null;
  is_alive?: boolean;
  spouse?: string | null;
  remarks?: string | null;
  birthday?: string | null;
  death_date?: string | null;
  residence_place?: string | null;
}

export async function createFamilyMember(
  input: CreateMemberInput
): Promise<{ success: boolean; error: string | null }> {
  const supabase = await createClient();

  const { error } = await supabase.from("family_members").insert({
    name: input.name,
    generation: input.generation,
    sibling_order: input.sibling_order,
    father_id: input.father_id,
    gender: input.gender,
    official_position: input.official_position,
    is_alive: input.is_alive ?? true,
    spouse: input.spouse,
    remarks: input.remarks,
    birthday: input.birthday,
    death_date: input.death_date,
    residence_place: input.residence_place,
  });

  if (error) {
    return { success: false, error: error.message };
  }

  revalidatePath("/family-tree", "layout");
  return { success: true, error: null };
}

export async function deleteFamilyMembers(
  ids: number[]
): Promise<{ success: boolean; error: string | null }> {
  if (ids.length === 0) {
    return { success: false, error: "没有选择要删除的成员" };
  }

  const supabase = await createClient();

  const { error } = await supabase
    .from("family_members")
    .delete()
    .in("id", ids);

  if (error) {
    return { success: false, error: error.message };
  }

  revalidatePath("/family-tree", "layout");
  return { success: true, error: null };
}

// 获取所有成员用于父亲选择下拉框
export async function fetchAllMembersForSelect(): Promise<{
  data: { id: number; name: string; generation: number | null }[];
  error: string | null;
}> {
  const supabase = await createClient();
  return fetchAllRows<Pick<FamilyMember, "id" | "name" | "generation">>((from, to) =>
    supabase.from("family_members")
      .select("id, name, generation", { count: "exact" })
      .order("generation", { ascending: true })
      .order("name", { ascending: true })
      .order("id", { ascending: true })
      .range(from, to)
  );
}

export interface UpdateMemberInput extends CreateMemberInput {
  id: number;
}

// 根据 ID 获取单个成员
export async function fetchMemberById(
  id: number
): Promise<FamilyMember | null> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("family_members")
    .select("*")
    .eq("id", id)
    .single();

  if (error || !data) {
    console.error("Error fetching member by id:", error);
    return null;
  }

  // 如果有父亲ID，查询父亲姓名
  let father_name: string | null = null;
  if (data.father_id) {
    const { data: father } = await supabase
      .from("family_members")
      .select("name")
      .eq("id", data.father_id)
      .single();
    father_name = father?.name || null;
  }

  return {
    ...data,
    father_name,
  } as FamilyMember;
}

export async function updateFamilyMember(
  input: UpdateMemberInput
): Promise<{ success: boolean; error: string | null }> {
  const supabase = await createClient();

  const { error } = await supabase
    .from("family_members")
    .update({
      name: input.name,
      generation: input.generation,
      sibling_order: input.sibling_order,
      father_id: input.father_id,
      gender: input.gender,
      official_position: input.official_position,
      is_alive: input.is_alive ?? true,
      spouse: input.spouse,
      remarks: input.remarks,
      birthday: input.birthday,
      death_date: input.death_date,
      residence_place: input.residence_place,
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.id);

  if (error) {
    return { success: false, error: error.message };
  }

  revalidatePath("/family-tree", "layout");
  return { success: true, error: null };
}

async function prepareMemberImport(
  supabase: Awaited<ReturnType<typeof createClient>>,
  input: ImportMemberInput[]
) {
  const members = normalizeImportMembers(input);
  const fatherNames = Array.from(
    new Set(members.map((member) => member.father_name).filter((name): name is string => !!name))
  );
  const existingMembers: ImportFatherCandidate[] = [];

  // 分批、分页读取，避免 URL 过长或查询行数上限漏掉同名候选人。
  for (let offset = 0; offset < fatherNames.length; offset += 100) {
    for (let from = 0; ;) {
      const { data, count, error } = await supabase
        .from("family_members")
        .select("id, name, generation", { count: "exact" })
        .in("name", fatherNames.slice(offset, offset + 100))
        .order("id", { ascending: true })
        .range(from, from + 199);

      if (error) throw new Error(`查询父亲信息失败：${error.message}`);
      if (count === null || !data || (data.length === 0 && from < count)) {
        throw new Error("未能读取完整的父亲候选信息，请重试");
      }
      existingMembers.push(...(data || []));
      from += data.length;
      if (from >= count) break;
    }
  }

  return { members, fathers: resolveImportFathers(members, existingMembers) };
}

// 上传后即检查父亲关联；真正导入前再次查询，避免使用过期的预览结果。
export async function previewFamilyMembersImport(
  members: ImportMemberInput[]
): Promise<{ fathers: ImportFatherMatch[]; error: string | null }> {
  try {
    const supabase = await createClient();
    const prepared = await prepareMemberImport(supabase, members);
    return { fathers: prepared.fathers, error: null };
  } catch (error) {
    return { fathers: [], error: error instanceof Error ? error.message : "检查父亲关联失败" };
  }
}

export async function batchCreateFamilyMembers(
  input: ImportMemberInput[]
): Promise<{ success: boolean; count: number; error: string | null }> {
  const supabase = await createClient();
  const insertedBatches: number[][] = [];
  let untrackedCount = 0;

  try {
    const { members, fathers } = await prepareMemberImport(supabase, input);
    const generations = new Map<number, number[]>();
    const importedIds = new Map<string, number>();

    members.forEach((member, index) => {
      const generation = member.generation ?? 0;
      const indices = generations.get(generation) || [];
      indices.push(index);
      generations.set(generation, indices);
    });

    // 先插入父辈并读取真实 ID，再写入子女；不依赖模板行顺序或数据库返回顺序。
    for (const generation of Array.from(generations.keys()).sort((a, b) => a - b)) {
      const indices = generations.get(generation)!;
      for (let offset = 0; offset < indices.length; offset += 200) {
        const payload = indices.slice(offset, offset + 200).map((index) => {
          const member = members[index];
          const father = fathers[index];
          let fatherId: number | null = null;
          if (father?.source === "existing") {
            fatherId = father.id;
          } else if (father?.source === "import") {
            const importedFather = members[father.index];
            const id = importedIds.get(importMemberKey(importedFather.name, importedFather.generation));
            if (id === undefined) throw new Error(`未取得「${member.father_name}」的父亲 ID，导入已停止`);
            fatherId = id;
          }

          return {
            name: member.name,
            generation: member.generation,
            sibling_order: member.sibling_order,
            father_id: fatherId,
            gender: member.gender,
            official_position: member.official_position,
            is_alive: member.is_alive ?? true,
            spouse: member.spouse,
            remarks: member.remarks,
            birthday: member.birthday,
            residence_place: member.residence_place,
          };
        });

        const { data, error } = await supabase
          .from("family_members")
          .insert(payload)
          .select("id, name, generation");

        if (error) throw new Error(error.message);
        insertedBatches.push((data || []).map((member) => member.id));
        if (!data || data.length !== payload.length) {
          untrackedCount += Math.max(0, payload.length - (data?.length ?? 0));
          throw new Error("未能取得全部新成员 ID，请检查数据库返回条数限制");
        }
        for (const member of data) {
          importedIds.set(importMemberKey(member.name, member.generation), member.id);
        }
      }
    }

    revalidatePath("/family-tree", "layout");
    return { success: true, count: members.length, error: null };
  } catch (error) {
    // 多代导入发生错误时，按子女到父辈的顺序清理本次新增数据。
    let remainingCount = untrackedCount;
    for (const ids of insertedBatches.reverse()) {
      if (ids.length === 0) continue;
      try {
        const { data, count, error: rollbackError } = await supabase
          .from("family_members")
          .delete({ count: "exact" })
          .in("id", ids)
          .select("id");
        remainingCount += rollbackError ? ids.length : Math.max(0, ids.length - (count ?? data?.length ?? 0));
      } catch {
        remainingCount += ids.length;
      }
    }
    if (insertedBatches.length > 0) revalidatePath("/family-tree", "layout");
    const message = error instanceof Error ? error.message : "导入失败，请稍后重试";
    return {
      success: false,
      count: remainingCount,
      error: remainingCount > 0 ? `${message}；仍有 ${remainingCount} 条本次新增记录未能撤销，请核对后再导入` : message,
    };
  }
}

export async function fetchMembersForTimeline(): Promise<{
  data: { id: number; name: string; birthday: string | null; death_date: string | null; generation: number | null }[];
  error: string | null;
}> {
  const supabase = await createClient();
  return fetchAllRows<Pick<FamilyMember, "id" | "name" | "birthday" | "death_date" | "generation">>((from, to) =>
    supabase.from("family_members")
      .select("id, name, birthday, death_date, generation", { count: "exact" })
      .order("birthday", { ascending: true })
      .order("id", { ascending: true })
      .range(from, to)
  );
}
