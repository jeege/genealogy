import { apiRequest } from "./client";
import type {
  BiographyMember,
  FamilyMember,
  ImportFatherMatch,
  ImportMemberInput,
  MemberInput,
  MemberOption,
  StatisticsData,
  TimelineMember,
} from "./types";

export interface FamilyMemberNode {
  id: number;
  name: string;
  generation: number | null;
  sibling_order: number | null;
  father_id: number | null;
  gender: "男" | "女" | null;
  official_position: string | null;
  is_alive: boolean;
  spouse: string | null;
  remarks: string | null;
  birthday: string | null;
  death_date: string | null;
  residence_place: string | null;
}

export type UpdateMemberInput = MemberInput & { id: number };

function message(error: unknown): string {
  return error instanceof Error && error.message ? error.message : "请求失败，请稍后重试";
}

export async function fetchFamilyMembers(
  page = 1,
  pageSize = 50,
  searchQuery = "",
): Promise<{ data: FamilyMember[]; count: number; error: string | null }> {
  const params = new URLSearchParams({
    page: String(Math.max(1, page)),
    page_size: String(Math.max(1, pageSize)),
  });
  if (searchQuery.trim()) params.set("search", searchQuery.trim());
  try {
    const payload = await apiRequest<{ data: FamilyMember[]; count: number }>(
      `/family-members?${params.toString()}`,
    );
    return { data: payload.data ?? [], count: payload.count ?? 0, error: null };
  } catch (error) {
    return { data: [], count: 0, error: message(error) };
  }
}

export async function createFamilyMember(
  input: MemberInput,
): Promise<{ success: boolean; error: string | null }> {
  try {
    await apiRequest<{ data: FamilyMember }>("/family-members", {
      method: "POST",
      body: JSON.stringify(input),
    });
    return { success: true, error: null };
  } catch (error) {
    return { success: false, error: message(error) };
  }
}

export async function updateFamilyMember(
  input: UpdateMemberInput,
): Promise<{ success: boolean; error: string | null }> {
  const { id, ...payload } = input;
  try {
    await apiRequest<{ data: FamilyMember }>(`/family-members/${id}`, {
      method: "PUT",
      body: JSON.stringify(payload),
    });
    return { success: true, error: null };
  } catch (error) {
    return { success: false, error: message(error) };
  }
}

export async function deleteFamilyMembers(
  ids: number[],
): Promise<{ success: boolean; error: string | null }> {
  if (ids.length === 0) return { success: false, error: "没有选择要删除的成员" };
  try {
    await apiRequest<{ success: boolean; deleted: number }>("/family-members", {
      method: "DELETE",
      body: JSON.stringify({ ids }),
    });
    return { success: true, error: null };
  } catch (error) {
    return { success: false, error: message(error) };
  }
}

export async function fetchAllMembersForSelect(): Promise<{
  data: MemberOption[];
  error: string | null;
}> {
  try {
    const payload = await apiRequest<{ data: MemberOption[] }>("/family-members/select");
    return { data: payload.data ?? [], error: null };
  } catch (error) {
    return { data: [], error: message(error) };
  }
}

export async function fetchMemberById(id: number): Promise<FamilyMember | null> {
  try {
    const payload = await apiRequest<{ data: FamilyMember }>(`/family-members/${id}`);
    return payload.data ?? null;
  } catch {
    return null;
  }
}

export async function fetchAllFamilyMembers(): Promise<{
  data: FamilyMemberNode[];
  error: string | null;
}> {
  try {
    const payload = await apiRequest<{ data: FamilyMemberNode[] }>("/family-members/all");
    return { data: payload.data ?? [], error: null };
  } catch (error) {
    return { data: [], error: message(error) };
  }
}

export async function fetchMembersForTimeline(): Promise<{
  data: TimelineMember[];
  error: string | null;
}> {
  try {
    const payload = await apiRequest<{ data: TimelineMember[] }>("/family-members/timeline");
    return { data: payload.data ?? [], error: null };
  } catch (error) {
    return { data: [], error: message(error) };
  }
}

export async function fetchMembersWithBiography(): Promise<{
  data: BiographyMember[];
  error: string | null;
}> {
  try {
    const payload = await apiRequest<{ data: BiographyMember[] }>("/family-members/biography");
    return { data: payload.data ?? [], error: null };
  } catch (error) {
    return { data: [], error: message(error) };
  }
}

export async function fetchFamilyStatistics(): Promise<{
  data: StatisticsData | null;
  error: string | null;
}> {
  try {
    const payload = await apiRequest<{ data: StatisticsData }>("/statistics");
    return { data: payload.data, error: null };
  } catch (error) {
    return { data: null, error: message(error) };
  }
}

export async function previewFamilyMembersImport(
  members: ImportMemberInput[],
): Promise<{ fathers: ImportFatherMatch[]; error: string | null }> {
  try {
    const payload = await apiRequest<{ fathers: ImportFatherMatch[] }>(
      "/family-members/import/preview",
      { method: "POST", body: JSON.stringify({ members }) },
    );
    return { fathers: payload.fathers ?? [], error: null };
  } catch (error) {
    return { fathers: [], error: message(error) };
  }
}

export async function batchCreateFamilyMembers(
  members: ImportMemberInput[],
): Promise<{ success: boolean; count: number; error: string | null }> {
  try {
    const payload = await apiRequest<{ success: boolean; count: number }>(
      "/family-members/import",
      { method: "POST", body: JSON.stringify({ members }) },
    );
    return { success: true, count: payload.count ?? 0, error: null };
  } catch (error) {
    return { success: false, count: 0, error: message(error) };
  }
}
