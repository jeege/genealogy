import assert from "node:assert/strict";
import { test } from "node:test";
import { loadTypeScript } from "./helpers/load-typescript.mjs";

const { buildCoupleUnits, unitKeyOf } = loadTypeScript(
  "src/pages/family-tree/graph/couple-layout.ts",
);

function member(id, overrides = {}) {
  return {
    id,
    name: `成员${id}`,
    generation: 1,
    sibling_order: null,
    father_id: null,
    gender: "男",
    official_position: null,
    is_alive: true,
    spouse: null,
    remarks: null,
    birthday: null,
    death_date: null,
    residence_place: null,
    spouses: [],
    ...overrides,
  };
}

function childMap(members) {
  const map = new Map();
  for (const m of members) {
    if (m.father_id !== null) {
      const list = map.get(m.father_id) ?? [];
      list.push(m.id);
      map.set(m.father_id, list);
    }
  }
  return map;
}

test("娶入的配偶合并进同一个节点，不再单独成为根节点", () => {
  const husband = member(1, { spouses: [{ marriage_id: 1, partner_id: 2, name: "妻子", status: "married" }] });
  const wife = member(2, { gender: "女", spouses: [{ marriage_id: 1, partner_id: 1, name: "成员1", status: "married" }] });
  const child = member(3, { generation: 2, father_id: 1 });
  const members = [husband, wife, child];

  const units = buildCoupleUnits(members, childMap(members));
  assert.equal(units.length, 2, "夫妻 + 孩子 = 2 个节点");
  assert.equal(units[0].primary.id, 1);
  assert.equal(units[0].partner?.id, 2, "妻子作为同伴并入丈夫节点");
  assert.deepEqual(units[0].children, [3]);
  assert.equal(unitKeyOf(units, 2), "1", "妻子映射到合并节点");
});

test("双方都已有父系位置时保持独立节点", () => {
  const root = member(0);
  const husband = member(1, { father_id: 0, spouses: [{ marriage_id: 1, partner_id: 2, name: "妻子", status: "married" }] });
  const wife = member(2, { gender: "女", father_id: 0, spouses: [{ marriage_id: 1, partner_id: 1, name: "丈夫", status: "married" }] });
  const members = [root, husband, wife];

  const units = buildCoupleUnits(members, childMap(members));
  assert.equal(units.length, 3, "各自有父系的夫妻不应合并");
  assert.equal(units.find((u) => u.primary.id === 1).partner, null);
});

test("配偶带来的子女并入合并节点，连线不丢", () => {
  const husband = member(1, { spouses: [{ marriage_id: 1, partner_id: 2, name: "妻子", status: "married" }] });
  const wife = member(2, { gender: "女", spouses: [{ marriage_id: 1, partner_id: 1, name: "成员1", status: "married" }] });
  const husbandChild = member(3, { father_id: 1 });
  const wifeChild = member(4, { father_id: 2 });
  const members = [husband, wife, husbandChild, wifeChild];

  const units = buildCoupleUnits(members, childMap(members));
  const merged = units.find((u) => u.primary.id === 1);
  assert.deepEqual(merged.children.sort(), [3, 4]);
});

test("没有结构化配偶时按姓名回退匹配", () => {
  const husband = member(1, { spouse: "成员2" });
  const wife = member(2, { name: "成员2", gender: "女" });
  const members = [husband, wife];

  const units = buildCoupleUnits(members, childMap(members));
  assert.equal(units.length, 1);
  assert.equal(units[0].partner?.id, 2);
});

test("一位成员不会出现在两个合并节点中", () => {
  const a = member(1, { spouses: [{ marriage_id: 1, partner_id: 2, name: "成员2", status: "married" }] });
  const b = member(2, { gender: "女", spouses: [
    { marriage_id: 1, partner_id: 1, name: "成员1", status: "married" },
    { marriage_id: 2, partner_id: 3, name: "成员3", status: "married" },
  ] });
  const c = member(3, { spouses: [{ marriage_id: 2, partner_id: 2, name: "成员2", status: "married" }] });
  const members = [a, b, c];

  const units = buildCoupleUnits(members, childMap(members));
  const seen = new Set();
  for (const unit of units) {
    assert.ok(!seen.has(unit.primary.id), "主成员重复出现");
    seen.add(unit.primary.id);
    if (unit.partner) {
      assert.ok(!seen.has(unit.partner.id), "同伴重复出现");
      seen.add(unit.partner.id);
    }
  }
  assert.deepEqual([...seen].sort(), [1, 2, 3], "所有成员都只出现一次");
});

test("空配偶列表与自引用不会产生合并", () => {
  const lone = member(1);
  const selfSpouse = member(2, { spouses: [{ marriage_id: 9, partner_id: 2, name: "成员2", status: "married" }] });
  const members = [lone, selfSpouse];
  const units = buildCoupleUnits(members, childMap(members));
  assert.equal(units.length, 2);
  assert.equal(units.every((unit) => unit.partner === null), true);
});
