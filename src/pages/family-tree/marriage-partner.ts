import type { Marriage } from "@/lib/api/types";

export interface MarriagePartner {
  id: number | null;
  name: string | null;
}

/** 判断当前成员是否确实参与了这段婚姻。 */
export function involvesMember(marriage: Marriage, memberId: number): boolean {
  return marriage.husband_id === memberId || marriage.wife_id === memberId;
}

/**
 * 计算婚姻记录中「另一位成员」。
 *
 * 后端返回的是整条婚姻（谁登记为丈夫、谁登记为妻子），所以必须相对当前
 * 成员判断：当前成员是丈夫时对方是妻子，反之对方是丈夫。曾直接取
 * `wife_id`，导致以妻子身份查看时显示的是自己。
 *
 * 若当前成员不在记录中（数据异常），回落到丈夫，避免界面出现空行；
 * 这类记录不应参与配偶集合计算，见 `marriedPartnerIds`。
 */
export function marriagePartner(marriage: Marriage, memberId: number): MarriagePartner {
  if (marriage.husband_id === memberId) {
    return { id: marriage.wife_id, name: marriage.wife_name };
  }
  if (marriage.wife_id === memberId) {
    return { id: marriage.husband_id, name: marriage.husband_name };
  }
  return { id: marriage.husband_id, name: marriage.husband_name };
}

/**
 * 已登记配偶的成员 ID 集合，用于从下拉候选中排除。
 * 只统计当前成员实际参与的婚姻，且不含当前成员自己。
 */
export function marriedPartnerIds(marriages: Marriage[], memberId: number): number[] {
  const ids = new Set<number>();
  for (const marriage of marriages) {
    if (!involvesMember(marriage, memberId)) continue;
    const partner = marriagePartner(marriage, memberId);
    if (partner.id !== null && partner.id !== memberId) ids.add(partner.id);
  }
  return [...ids];
}
