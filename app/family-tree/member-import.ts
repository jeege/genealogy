import type { ImportMemberInput } from "@/lib/api/types";

export type { ImportFatherMatch, ImportMemberInput } from "@/lib/api/types";

function numberOrNull(value: string | null): number | null {
  if (value === null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * 解析 Excel/CSV 行。姓名、世代与父亲的最终校验由 Go 后端完成，
 * 前端只负责把中文表头映射为 API 字段。
 */
export function parseImportRows(rows: Record<string, unknown>[]): ImportMemberInput[] {
  if (rows.length === 0) {
    throw new Error("文件中没有有效的成员数据，请检查表头是否正确");
  }

  return rows.map((source, index) => {
    const row = Object.fromEntries(Object.entries(source).map(([key, value]) => [key.trim(), value]));
    const text = (key: string) => String(row[key] ?? "").trim() || null;
    const numberField = (key: string, label: string) => {
      const raw = text(key);
      const parsed = numberOrNull(raw);
      if (raw !== null && parsed === null) {
        throw new Error(`第 ${index + 1} 条记录的${label}必须为数字`);
      }
      return parsed;
    };
    const gender = text("性别");

    return {
      name: text("姓名") ?? "",
      generation: numberField("世代", "世代"),
      sibling_order: numberField("排行", "排行"),
      father_name: text("父亲姓名") || text("父亲"),
      gender: gender === "男" || gender === "女" ? gender : null,
      official_position: text("官职"),
      is_alive: text("是否在世") !== "否",
      spouse: text("配偶"),
      remarks: text("生平事迹") || text("备注"),
      birthday: text("生日"),
      residence_place: text("居住地"),
    };
  });
}
