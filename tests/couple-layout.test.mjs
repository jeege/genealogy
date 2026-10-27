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
  assert.deepEqual(units[0].partners.map((p) => p.id), [2], "妻子作为同伴并入丈夫节点");
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
  assert.deepEqual(units.find((u) => u.primary.id === 1).partners, []);
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
  assert.deepEqual(units[0].partners.map((p) => p.id), [2]);
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
    for (const partner of unit.partners) {
      assert.ok(!seen.has(partner.id), "同伴重复出现");
      seen.add(partner.id);
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
  assert.equal(units.every((unit) => unit.partners.length === 0), true);
});

test("多次婚姻：主成员带多位配偶，不再只并入第一位", () => {
  // 复现真实数据：林志杰(4) 有两位妻子（顾梦恬 / 测试），此前只有第一位被合并，
  // 第二位变成孤立的悬空节点。
  const husband = member(4, {
    gender: "男",
    father_id: 7,
    spouses: [
      { marriage_id: 19, partner_id: 10, name: "顾梦恬", status: "married" },
      { marriage_id: 20, partner_id: 50, name: "测试", status: "married" },
    ],
  });
  const first = member(10, {
    gender: "女",
    name: "顾梦恬",
    spouses: [{ marriage_id: 19, partner_id: 4, name: "林志杰", status: "married" }],
  });
  const second = member(50, {
    gender: "女",
    name: "测试",
    spouses: [{ marriage_id: 20, partner_id: 4, name: "林志杰", status: "married" }],
  });
  const father = member(7, { gender: "男" });
  const members = [father, husband, first, second];

  const units = buildCoupleUnits(members, childMap(members));
  const unit = units.find((u) => u.primary.id === 4);
  assert.deepEqual(unit.partners.map((p) => p.id), [10, 50], "两位配偶都应并入同一节点");
  // 两位配偶都不再单独占节点。
  assert.equal(units.filter((u) => u.primary.id === 10 || u.primary.id === 50).length, 0);
  // 成员 -> 节点映射覆盖全部三人。
  assert.equal(unitKeyOf(units, 4), "4");
  assert.equal(unitKeyOf(units, 10), "4");
  assert.equal(unitKeyOf(units, 50), "4");
});

test("多次婚姻：各配偶的子女都归入主成员节点", () => {
  const husband = member(1, {
    spouses: [
      { marriage_id: 1, partner_id: 2, name: "前妻", status: "divorced" },
      { marriage_id: 2, partner_id: 3, name: "续弦", status: "married" },
    ],
  });
  const first = member(2, { gender: "女", spouses: [{ marriage_id: 1, partner_id: 1, name: "成员1", status: "divorced" }] });
  const second = member(3, { gender: "女", spouses: [{ marriage_id: 2, partner_id: 1, name: "成员1", status: "married" }] });
  const childA = member(10, { father_id: 1 });
  const childB = member(11, { father_id: 3 });
  const members = [husband, first, second, childA, childB];

  const unit = buildCoupleUnits(members, childMap(members)).find((u) => u.primary.id === 1);
  assert.deepEqual(unit.partners.map((p) => p.id).sort(), [2, 3]);
  assert.deepEqual(unit.children.sort((a, b) => a - b), [10, 11], "两位配偶的子女都要保留连线");
});

test("多次婚姻：配偶之间不会互相抢占或重复并入", () => {
  // 妻子(2) 先被丈夫(1) 并入；丈夫(1) 的第二位配偶(3) 也必须一并加入，
  // 而不是因为 ownerOf 已有记录就整体跳过。
  const husband = member(1, {
    spouses: [
      { marriage_id: 1, partner_id: 2, name: "妻一", status: "married" },
      { marriage_id: 2, partner_id: 3, name: "妻二", status: "married" },
    ],
  });
  const wifeOne = member(2, { gender: "女", spouses: [{ marriage_id: 1, partner_id: 1, name: "成员1", status: "married" }] });
  const wifeTwo = member(3, { gender: "女", spouses: [{ marriage_id: 2, partner_id: 1, name: "成员1", status: "married" }] });
  const members = [husband, wifeOne, wifeTwo];

  const units = buildCoupleUnits(members, childMap(members));
  assert.equal(units.length, 1, "三人应合成一个节点");
  assert.deepEqual(units[0].partners.map((p) => p.id), [2, 3]);
});

test("自由文本配偶备注支持多位（顿号/逗号分隔）", () => {
  const husband = member(1, { spouse: "王氏、李氏" });
  const wifeOne = member(2, { name: "王氏", gender: "女" });
  const wifeTwo = member(3, { name: "李氏", gender: "女" });
  const members = [husband, wifeOne, wifeTwo];

  const unit = buildCoupleUnits(members, childMap(members)).find((u) => u.primary.id === 1);
  assert.deepEqual(unit.partners.map((p) => p.id), [2, 3]);
});
