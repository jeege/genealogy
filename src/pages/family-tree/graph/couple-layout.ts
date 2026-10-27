import type { FamilyMemberNode } from "./actions";

/** 夫妻合并节点：丈夫/妻子中父系链条更完整的一方作为「主成员」，另一方作为「同伴」。 */
export interface CoupleUnit {
  /** React Flow 节点 id，主成员的真实 ID。 */
  key: string;
  primary: FamilyMemberNode;
  partner: FamilyMemberNode | null;
  /** 主成员的子女（含同伴带来的子女）。 */
  children: number[];
}

/**
 * 找出所有可合并的夫妻对。
 *
 * 规则：
 * 1. 仅当双方在族谱中都有自己的父系位置时才不合并，避免同一节点出现两条
 *    来自不同父亲的入边；其余情况（典型的「娶入」婚姻）都合成一个节点。
 * 2. 一位成员最多出现在一个合并节点里。
 * 3. 优先使用结构化婚姻（spouses），没有结构化数据时回退到自由文本 spouse
 *    的姓名匹配。
 */
export function buildCoupleUnits(
  members: FamilyMemberNode[],
  childrenMap: Map<number, number[]>,
): CoupleUnit[] {
  const byId = new Map(members.map((member) => [member.id, member]));
  const parented = (member: FamilyMemberNode) =>
    member.father_id !== null && byId.has(member.father_id);

  const consumed = new Set<number>();
  const partnerOf = new Map<number, FamilyMemberNode>();

  for (const member of members) {
    if (consumed.has(member.id)) continue;

    const candidates: FamilyMemberNode[] = [];
    for (const link of member.spouses ?? []) {
      if (link.partner_id === null || link.partner_id === member.id) continue;
      const partner = byId.get(link.partner_id);
      if (partner) candidates.push(partner);
    }
    // 回退：没有结构化配偶时，按姓名匹配自由文本备注。
    if (candidates.length === 0 && member.spouse) {
      const text = member.spouse.trim();
      if (text) {
        for (const other of members) {
          if (other.id === member.id || other.name !== text) continue;
          candidates.push(other);
          break;
        }
      }
    }

    for (const partner of candidates) {
      if (consumed.has(partner.id) || consumed.has(member.id)) continue;
      if (partnerOf.has(member.id) || partnerOf.has(partner.id)) continue;
      // 双方都已在族谱中各有父系位置时保持独立，避免一个节点出现两个父亲。
      if (parented(member) && parented(partner)) continue;

      // 主成员选择：优先有父系关系的一方（子女从该侧继承连线的语义）；
      // 双方情况相同（典型娶入）时优先丈夫，再按 ID 保证结果稳定。
      let primary = member;
      let secondary = partner;
      if (parented(partner) && !parented(member)) {
        primary = partner;
        secondary = member;
      } else if (parented(member) === parented(partner)) {
        const rank = (candidate: FamilyMemberNode) => (candidate.gender === "男" ? 0 : 1);
        if (rank(partner) < rank(member) || (rank(partner) === rank(member) && partner.id < member.id)) {
          primary = partner;
          secondary = member;
        }
      }
      partnerOf.set(primary.id, secondary);
      consumed.add(secondary.id);
      break;
    }
  }

  // 合并后，把同伴的子女也归到主成员名下，使连线仍然从合并节点发出。
  const mergedChildren = new Map<number, number[]>();
  for (const [primaryId, partner] of partnerOf) {
    const ids = new Set<number>(childrenMap.get(primaryId) ?? []);
    for (const childId of childrenMap.get(partner.id) ?? []) ids.add(childId);
    mergedChildren.set(primaryId, [...ids]);
  }

  const units: CoupleUnit[] = [];
  for (const member of members) {
    if (consumed.has(member.id)) continue;
    const partner = partnerOf.get(member.id) ?? null;
    units.push({
      key: String(member.id),
      primary: member,
      partner,
      children: partner
        ? (mergedChildren.get(member.id) ?? [...(childrenMap.get(member.id) ?? [])])
        : [...(childrenMap.get(member.id) ?? [])],
    });
  }
  return units;
}

/** 把成员 ID 映射到它所在的合并节点 key，供父子连线使用。 */
export function unitKeyOf(units: CoupleUnit[], memberId: number): string | null {
  for (const unit of units) {
    if (unit.primary.id === memberId) return unit.key;
    if (unit.partner?.id === memberId) return unit.key;
  }
  return null;
}
