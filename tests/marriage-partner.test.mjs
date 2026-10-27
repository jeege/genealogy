import assert from "node:assert/strict";
import { test } from "node:test";
import { loadTypeScript } from "./helpers/load-typescript.mjs";

const { marriagePartner, marriedPartnerIds } = loadTypeScript(
  "src/pages/family-tree/marriage-partner.ts",
);

function marriage(overrides = {}) {
  return {
    id: 1,
    husband_id: 1,
    husband_name: "刘守仁",
    wife_id: 2,
    wife_name: "王秀英",
    status: "married",
    married_on: null,
    divorced_on: null,
    married_on_raw: null,
    divorced_on_raw: null,
    note: null,
    updated_at: "2026-10-27T00:00:00Z",
    ...overrides,
  };
}

test("以丈夫身份查看时，对方是妻子", () => {
  assert.deepEqual(marriagePartner(marriage(), 1), { id: 2, name: "王秀英" });
});

test("以妻子身份查看时，对方是丈夫而不是自己", () => {
  // 回归：曾固定取 wife_id，导致妻子的弹窗里配偶显示成自己。
  const partner = marriagePartner(marriage(), 2);
  assert.deepEqual(partner, { id: 1, name: "刘守仁" });
  assert.notEqual(partner.id, 2);
});

test("当前成员不在记录中时回落到丈夫，不返回空行", () => {
  assert.deepEqual(marriagePartner(marriage(), 99), { id: 1, name: "刘守仁" });
});

test("配偶 ID 集合按当前成员视角计算", () => {
  const marriages = [
    marriage({ id: 1, husband_id: 1, husband_name: "刘守仁", wife_id: 2, wife_name: "王秀英" }),
    marriage({ id: 2, husband_id: 3, husband_name: "刘建国", wife_id: 2, wife_name: "王秀英" }),
  ];
  // 王秀英(2) 的两段婚姻，另一方分别是 1 和 3。
  assert.deepEqual(marriedPartnerIds(marriages, 2).sort(), [1, 3]);
  // 刘守仁(1) 只有一段，另一方是 2。
  assert.deepEqual(marriedPartnerIds(marriages, 1), [2]);
  // 不应把当前成员自己算作配偶。
  assert.ok(!marriedPartnerIds(marriages, 2).includes(2));
});

test("缺少妻子信息的记录不产生配偶", () => {
  const unknownWife = marriage({ wife_id: null, wife_name: null });
  assert.deepEqual(marriedPartnerIds([unknownWife], 1), []);
  assert.deepEqual(marriagePartner(unknownWife, 1), { id: null, name: null });
});
