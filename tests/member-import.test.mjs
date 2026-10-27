import assert from "node:assert/strict";
import { test } from "node:test";
import { loadTypeScript } from "./helpers/load-typescript.mjs";

const { parseImportRows } = loadTypeScript("src/pages/family-tree/member-import.ts");

test("中文表头映射为后端导入字段", () => {
  const [member] = parseImportRows([{
    姓名: " 刘某某 ",
    世代: "20",
    排行: "2",
    父亲姓名: "刘父",
    性别: "女",
    官职: "进士",
    是否在世: "否",
    配偶: "王氏",
    生平事迹: "字某某",
    生日: "1990-01-01",
    居住地: "某地",
  }]);
  assert.equal(member.name, "刘某某");
  assert.equal(member.generation, 20);
  assert.equal(member.sibling_order, 2);
  assert.equal(member.father_name, "刘父");
  assert.equal(member.gender, "女");
  assert.equal(member.official_position, "进士");
  assert.equal(member.is_alive, false);
  assert.equal(member.spouse, "王氏");
  assert.equal(member.remarks, "字某某");
  assert.equal(member.birthday, "1990-01-01");
  assert.equal(member.residence_place, "某地");
});

test("兼容旧表头父亲、备注，并默认在世", () => {
  const [member] = parseImportRows([{
    姓名: "刘某",
    世代: "2",
    父亲: "刘父",
    备注: "旧备注",
  }]);
  assert.equal(member.father_name, "刘父");
  assert.equal(member.remarks, "旧备注");
  assert.equal(member.is_alive, true);
  assert.equal(member.gender, null);
});

test("无效数字明确报错，未知性别不伪造为有效值", () => {
  assert.throws(() => parseImportRows([{ 姓名: "刘某", 世代: "abc" }]), /世代必须为数字/);
  assert.throws(() => parseImportRows([{ 姓名: "刘某", 排行: "x" }]), /排行必须为数字/);
  const [member] = parseImportRows([{ 姓名: "刘某", 性别: "未知" }]);
  assert.equal(member.gender, null);
});

test("空文件给出明确错误", () => {
  assert.throws(() => parseImportRows([]), /没有有效的成员数据/);
});
