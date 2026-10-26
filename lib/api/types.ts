/** 与 Go 后端 JSON 保持一致的前端类型。 */

export interface AuthUser {
  id: number;
  email: string;
  created_at?: string;
}

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

export interface MemberOption {
  id: number;
  name: string;
  generation: number | null;
}

export interface TimelineMember {
  id: number;
  name: string;
  birthday: string | null;
  death_date: string | null;
  generation: number | null;
}

export interface BiographyMember {
  id: number;
  name: string;
  generation: number | null;
  sibling_order: number | null;
  gender: "男" | "女" | null;
  birthday: string | null;
  death_date: string | null;
  is_alive: boolean;
  spouse: string | null;
  official_position: string | null;
  residence_place: string | null;
  remarks: string;
  father_name: string | null;
}

export interface MemberInput {
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

export interface UpdateMemberInput extends MemberInput {
  id: number;
}

export interface ImportMemberInput {
  name: string;
  generation?: number | null;
  sibling_order?: number | null;
  father_name?: string | null;
  gender?: "男" | "女" | null;
  official_position?: string | null;
  is_alive?: boolean;
  spouse?: string | null;
  remarks?: string | null;
  birthday?: string | null;
  residence_place?: string | null;
}

export type ImportFatherMatch =
  | { source: "existing"; id: number }
  | { source: "import"; index: number }
  | null;

export interface ChartValue {
  name: string;
  value: number;
  fill: string;
  // recharts 的 ChartDataInput 要求可索引，保留具体字段类型以便图表使用。
  [key: string]: string | number;
}

export interface NamedCount {
  name: string;
  value: number;
}

export interface NameCount {
  name: string;
  count: number;
}

export interface StatisticsData {
  totalMembers: number;
  genderStats: ChartValue[];
  generationStats: NamedCount[];
  statusStats: ChartValue[];
  ageStats: NamedCount[];
  commonNames: NameCount[];
}

export interface GEDCOMImportPreview {
  encoding: string;
  version: string;
  members: number;
  families: number;
  with_father: number;
  with_birth_date: number;
  missing_name: number;
  duplicate_names: number;
  ignored_records: number;
  unsupported_tags: string[];
  warnings: string[];
}

export interface GEDCOMImportResult {
  members: number;
  families: number;
  warnings: string[];
}
