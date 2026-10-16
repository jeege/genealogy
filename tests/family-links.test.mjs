import assert from "node:assert/strict";
import { test } from "node:test";
import { forceSimulation, forceLink } from "d3-force-3d";
import { loadTypeScript } from "./helpers/load-typescript.mjs";

const linksModule = () => loadTypeScript("app/family-tree/graph/family-links.ts");
// 按生产导入路径加载真实共享模块，避免巡游测试替换掉连线规则。
const tourModule = () => loadTypeScript("app/family-tree/graph-3d/tour-utils.ts", {
  "../graph/family-links": linksModule(),
});

function member(id, father_id = null) {
  return { id, father_id, name: `成员${id}` };
}

function assertValidSimulation(members, links) {
  const nodes = members.map(member => ({ ...member }));
  const simulation = forceSimulation(nodes, 3).stop();
  try {
    assert.doesNotThrow(() => simulation.force("link", forceLink(links).id(node => node.id)));
    simulation.tick();
    assert.equal(nodes.length, members.length, "孤立成员也必须保留");
    assert.ok(nodes.every(node => [node.x, node.y, node.z].every(Number.isFinite)));
  } finally {
    simulation.stop();
  }
}

test("真实 d3-force-3d 对原始悬空父子连线抛错", () => {
  const members = [member(1, 999)];
  const simulation = forceSimulation(members.map(member => ({ ...member })), 3).stop();
  try {
    assert.throws(
      () => simulation.force("link", forceLink([{ source: 999, target: 1 }]).id(node => node.id)),
      /node not found: 999/
    );
  } finally {
    simulation.stop();
  }
});

test("缺失父亲、自引用和无父亲成员不生成连线，孤立节点仍可参与模拟", () => {
  const members = [member(1, 999), member(2, 2), member(3)];
  const links = linksModule().getFamilyLinks(members);
  assert.deepEqual(links, []);
  assertValidSimulation(members, links);
});

test("只保留真实父子连线，ID 为 0 的真实父亲也有效且不修改成员", () => {
  const members = [member(0), member(1, 0), member(2, 1), member(3, 999)];
  const original = structuredClone(members);
  const links = linksModule().getFamilyLinks(members);
  assert.deepEqual(links, [{ source: 0, target: 1 }, { source: 1, target: 2 }]);
  assert.deepEqual(members, original);
  assertValidSimulation(members, links);
  assert.deepEqual(members, original, "d3 模拟不能修改原始成员");
});

test("空成员列表没有连线和巡游路径", () => {
  assert.deepEqual(linksModule().getFamilyLinks([]), []);
  assert.equal(tourModule().findShortestPath([], 1, 1), null);
});

test("正常父子、兄弟和不同分支使用双向最短巡游路径", () => {
  const members = [member(1), member(2, 1), member(3, 1), member(4, 2), member(5, 3)];
  const { findShortestPath } = tourModule();
  assert.deepEqual(findShortestPath(members, 1, 2), [members[0], members[1]]);
  assert.deepEqual(findShortestPath(members, 2, 1), [members[1], members[0]]);
  assert.deepEqual(findShortestPath(members, 4, 5), [members[3], members[1], members[0], members[2], members[4]]);
  assert.deepEqual(findShortestPath(members, 3, 3), [members[2]]);
});

test("两个成员引用同一个缺失父亲时不得生成虚构巡游路径", () => {
  const members = [member(1, 999), member(2, 999)];
  assert.equal(tourModule().findShortestPath(members, 1, 2), null);
});

test("未知起终点均无巡游路径，即使未知 ID 被成员引用", () => {
  const members = [member(1, 999), member(2, 1)];
  const { findShortestPath } = tourModule();
  for (const [start, end] of [[999, 1], [1, 999], [999, 999], [123, 2], [1, 123]]) {
    assert.equal(findShortestPath(members, start, end), null, `${start} -> ${end}`);
  }
});

test("自引用与不相连的真实成员不会产生跨支系巡游路径", () => {
  const members = [member(1, 1), member(2), member(3, 2)];
  const { findShortestPath } = tourModule();
  assert.deepEqual(findShortestPath(members, 1, 1), [members[0]]);
  assert.equal(findShortestPath(members, 1, 3), null);
});

test("巡游可经过 ID 为 0 的真实父亲", () => {
  const members = [member(0), member(1, 0), member(2, 0)];
  assert.deepEqual(tourModule().findShortestPath(members, 1, 2), [members[1], members[0], members[2]]);
});

test("合并分页后的完整数组可连接不同页面的父子", () => {
  const firstPage = Array.from({ length: 500 }, (_, i) => member(i + 1));
  const secondPage = [member(501, 1), member(502, 501)];
  const members = [...firstPage, ...secondPage];
  const links = linksModule().getFamilyLinks(members);
  assert.deepEqual(links, [{ source: 1, target: 501 }, { source: 501, target: 502 }]);
  assert.deepEqual(tourModule().findShortestPath(members, 1, 502), [firstPage[0], ...secondPage]);
  assertValidSimulation(members, links);
});

test("5000 个有效成员的全部连线和长巡游路径均完整且可供真实 d3 模拟", () => {
  const members = Array.from({ length: 5000 }, (_, i) => member(i + 1, i === 0 ? null : i));
  const links = linksModule().getFamilyLinks(members);
  assert.equal(links.length, members.length - 1);
  assert.deepEqual(links[0], { source: 1, target: 2 });
  assert.deepEqual(links.at(-1), { source: 4999, target: 5000 });
  assert.deepEqual(tourModule().findShortestPath(members, 1, 5000), members);
  assertValidSimulation(members, links);
});
