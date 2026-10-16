import type { FamilyMemberNode } from "../graph/actions";
import { getFamilyLinks } from "../graph/family-links";

/**
 * 使用 BFS 查找成员间的最短路径。
 * 将真实父子连线视为无向边，允许跨支系巡游。
 */
export function findShortestPath(
  members: FamilyMemberNode[],
  startId: number,
  endId: number
): FamilyMemberNode[] | null {
  const memberMap = new Map(members.map(member => [member.id, member]));
  if (!memberMap.has(startId) || !memberMap.has(endId)) return null;

  if (startId === endId) {
    return [memberMap.get(startId)!];
  }

  // 1. 只为真实节点和有效父子连线建立双向邻接表。
  const adj = new Map<number, number[]>();
  members.forEach(member => adj.set(member.id, []));
  getFamilyLinks(members).forEach(({ source, target }) => {
    adj.get(source)!.push(target);
    adj.get(target)!.push(source);
  });

  // 2. BFS
  const queue: number[] = [startId];
  const visited = new Set<number>([startId]);
  const parentMap = new Map<number, number>(); // To reconstruct path: child -> parent in search tree

  while (queue.length > 0) {
    const currentId = queue.shift()!;

    if (currentId === endId) {
      // Found target, reconstruct path
      const path: FamilyMemberNode[] = [];
      let traceId: number | undefined = endId;
      
      while (traceId !== undefined) {
        const member = memberMap.get(traceId);
        if (member) path.unshift(member);
        traceId = parentMap.get(traceId);
      }
      return path;
    }

    const neighbors = adj.get(currentId) || [];
    for (const neighborId of neighbors) {
      if (!visited.has(neighborId)) {
        visited.add(neighborId);
        parentMap.set(neighborId, currentId);
        queue.push(neighborId);
      }
    }
  }

  // No path found
  return null;
}
