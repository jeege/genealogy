// 仅连接真实存在且不同的父子节点，保留没有有效连线的成员。
export function getFamilyLinks(members: { id: number; father_id: number | null }[]) {
  const ids = new Set(members.map(member => member.id));
  return members.flatMap(member =>
    member.father_id !== null && member.father_id !== member.id && ids.has(member.father_id)
      ? [{ source: member.father_id, target: member.id }]
      : []
  );
}
