/** 父子连线：仅连接真实存在且不同的节点，保留没有有效连线的成员。 */
export function getFamilyLinks(members: { id: number; father_id: number | null }[]) {
  const ids = new Set(members.map((member) => member.id));
  return members.flatMap((member) =>
    member.father_id !== null && member.father_id !== member.id && ids.has(member.father_id)
      ? [{ source: member.father_id, target: member.id }]
      : [],
  );
}

export interface MarriageLinkInput {
  id: number;
  father_id: number | null;
  spouses?: { partner_id: number | null }[];
}

/**
 * 配偶连线：仅连接确实互为配偶的真实成员，用于 3D 图把夫妻拉近，
 * 避免配偶成为孤立漂浮的节点。每对只输出一次，并按 id 归一化方向。
 */
export function getSpouseLinks(members: MarriageLinkInput[]) {
  const ids = new Set(members.map((member) => member.id));
  const seen = new Set<string>();
  const links: { source: number; target: number }[] = [];
  for (const member of members) {
    for (const spouse of member.spouses ?? []) {
      const partnerId = spouse.partner_id;
      if (partnerId === null || partnerId === member.id || !ids.has(partnerId)) continue;
      const low = Math.min(member.id, partnerId);
      const high = Math.max(member.id, partnerId);
      const key = `${low}-${high}`;
      if (seen.has(key)) continue;
      seen.add(key);
      links.push({ source: low, target: high });
    }
  }
  return links;
}
