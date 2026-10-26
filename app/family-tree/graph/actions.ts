export type { FamilyMemberNode } from "@/lib/api/family";
export { fetchAllFamilyMembers } from "@/lib/api/family";

export interface FetchGraphResult {
  data: import("@/lib/api/family").FamilyMemberNode[];
  error: string | null;
}
