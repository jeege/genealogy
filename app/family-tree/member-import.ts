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

export interface ImportFatherCandidate {
  id: number;
  name: string;
  generation: number | null;
}

export type ImportFatherMatch =
  | { source: "existing"; id: number }
  | { source: "import"; index: number }
  | null;

export function importMemberKey(name: string, generation: number | null | undefined) {
  return JSON.stringify([name.trim(), generation ?? null]);
}

export function normalizeImportMembers(members: ImportMemberInput[]): ImportMemberInput[] {
  if (members.length === 0) {
    throw new Error("文件中没有有效的成员数据，请检查表头是否正确");
  }

  return members.map((member, index) => {
    const name = member.name.trim();
    const father_name = member.father_name?.trim() || null;
    const generation = member.generation ?? null;
    const label = `第 ${index + 1} 条记录${name ? `「${name}」` : ""}`;

    if (!name) throw new Error(`${label}缺少姓名`);
    if (generation !== null && (!Number.isInteger(generation) || generation < 1 || generation > 2147483647)) {
      throw new Error(`${label}的世代必须为正整数`);
    }
    if (father_name && (generation === null || generation <= 1)) {
      throw new Error(`${label}填写了父亲姓名，成员世代必须为大于 1 的整数`);
    }

    return { ...member, name, father_name, generation };
  });
}

// 模板中的世代属于子女，父亲按上一世代匹配；兼容旧表头「父亲」。
export function parseImportRows(rows: Record<string, unknown>[]): ImportMemberInput[] {
  const members = rows.map((source) => {
    const row = Object.fromEntries(Object.entries(source).map(([key, value]) => [key.trim(), value]));
    const text = (key: string) => String(row[key] ?? "").trim() || null;

    return {
      name: text("姓名") || "",
      generation: text("世代") ? Number(text("世代")) : null,
      sibling_order: text("排行") ? Number(text("排行")) : null,
      father_name: text("父亲姓名") || text("父亲"),
      gender: text("性别") === "女" ? "女" as const : "男" as const,
      official_position: text("官职"),
      is_alive: text("是否在世") !== "否",
      spouse: text("配偶"),
      remarks: text("生平事迹") || text("备注"),
      birthday: text("生日"),
      residence_place: text("居住地"),
    };
  });

  return normalizeImportMembers(members);
}

export function resolveImportFathers(
  members: ImportMemberInput[],
  existingMembers: ImportFatherCandidate[]
): ImportFatherMatch[] {
  const candidates = new Map<string, Exclude<ImportFatherMatch, null>[]>();
  const addCandidate = (key: string, candidate: Exclude<ImportFatherMatch, null>) => {
    const matches = candidates.get(key) || [];
    matches.push(candidate);
    candidates.set(key, matches);
  };

  for (const member of existingMembers) {
    addCandidate(importMemberKey(member.name, member.generation), { source: "existing", id: member.id });
  }
  members.forEach((member, index) => {
    addCandidate(importMemberKey(member.name, member.generation), { source: "import", index });
  });

  return members.map((member, index) => {
    if (!member.father_name) return null;

    const fatherGeneration = member.generation! - 1;
    const matches = candidates.get(importMemberKey(member.father_name, fatherGeneration)) || [];
    const label = `第 ${index + 1} 条记录「${member.name}」的父亲「${member.father_name}」（第 ${fatherGeneration} 世）`;

    if (matches.length === 0) {
      throw new Error(`${label}未找到，请检查姓名、世代，或将父亲加入同一份导入文件`);
    }
    if (matches.length > 1) {
      throw new Error(`${label}存在 ${matches.length} 个同名同世代成员，无法唯一匹配，请先核对数据`);
    }

    return matches[0];
  });
}
