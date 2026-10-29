/** 与 Go 后端 JSON 保持一致的前端类型。 */

export interface AuthUser {
  id: number;
  username: string;
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
  remarks: string | null;
  birthday: string | null;
  death_date: string | null;
  residence_place: string | null;
  spouses: SpouseLink[];
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
  official_position: string | null;
  residence_place: string | null;
  remarks: string;
  father_name: string | null;
  spouses: SpouseLink[];
}

export interface MemberInput {
  name: string;
  generation?: number | null;
  sibling_order?: number | null;
  father_id?: number | null;
  gender?: "男" | "女" | null;
  official_position?: string | null;
  is_alive?: boolean;
  remarks?: string | null;
  birthday?: string | null;
  death_date?: string | null;
  residence_place?: string | null;
  /** 要建立的配偶成员 ID；不传表示不改变现有配偶关系，空数组表示全部解除。 */
  spouse_ids?: number[];
  spouse_note?: string | null;
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

/** 成员照片：URL 由后端按存储配置拼好，前端直接用。 */
export interface MemberPhoto {
  id: number;
  member_id: number;
  url: string;
  thumbnail_url: string;
  width: number;
  height: number;
  byte_size: number;
  caption: string | null;
  sort_order: number;
  created_at: string;
}

export type MarriageStatus = "married" | "divorced" | "widowed";

export interface Marriage {
  id: number;
  husband_id: number;
  husband_name: string;
  wife_id: number | null;
  wife_name: string | null;
  status: MarriageStatus;
  married_on: string | null;
  divorced_on: string | null;
  married_on_raw: string | null;
  divorced_on_raw: string | null;
  note: string | null;
  updated_at: string;
}

/** 列表与关系图使用的配偶摘要。 */
export interface SpouseLink {
  marriage_id: number;
  partner_id: number | null;
  name: string;
  status: string;
}

export interface MarriageInput {
  husband_id: number;
  wife_id?: number | null;
  status?: MarriageStatus;
  married_on?: string | null;
  divorced_on?: string | null;
  note?: string | null;
}
