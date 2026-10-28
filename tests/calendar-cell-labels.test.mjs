import assert from "node:assert/strict";
import { test } from "node:test";
import { loadTypeScript } from "./helpers/load-typescript.mjs";

const lunar = loadTypeScript("src/lib/calendar/lunar.ts");

/**
 * 日历弹层里每个格子的第二行文案：节日 > 节气 > 农历日。
 * 这些断言同时保护「一遍遍改日期选择器」时容易退化的文案规则。
 */

test("节日的优先级高于农历日与节气", () => {
  // 元旦是公历节日，当天农历为冬月十三。
  assert.equal(lunar.lunarCellLabel("2026-01-01"), "元旦");
  // 国庆节在农历八月二十一，仍然显示节日。
  assert.equal(lunar.lunarCellLabel("2026-10-01"), "国庆节");
});

test("春节与除夕按农历年边界显示", () => {
  // 2026 年春节是 2 月 17 日，前一天 2 月 16 日为除夕。
  assert.equal(lunar.lunarCellLabel("2026-02-17"), "春节");
  assert.equal(lunar.lunarCellLabel("2026-02-16"), "除夕");
  // 2024 年春节 2 月 10 日，2 月 9 日除夕。
  assert.equal(lunar.lunarCellLabel("2024-02-10"), "春节");
  assert.equal(lunar.lunarCellLabel("2024-02-09"), "除夕");
});

test("农历节日按农历月日匹配（中秋、端午等）", () => {
  // 2026 中秋 = 农历八月十五 = 2026-09-25；端午 = 五月初五 = 2026-06-19。
  assert.equal(lunar.lunarCellLabel("2026-09-25"), "中秋");
  assert.equal(lunar.lunarCellLabel("2026-06-19"), "端午");
});

test("节气日期显示节气名", () => {
  assert.equal(lunar.lunarCellLabel("2026-12-22"), "冬至");
  assert.equal(lunar.lunarCellLabel("2026-01-05"), "小寒");
});

test("普通日子显示农历日，初一显示月名", () => {
  assert.equal(lunar.lunarCellLabel("2026-02-18"), "初二");
  // 闰月初一显示「闰二月」，便于与普通二月区分。
  assert.equal(lunar.lunarCellLabel("2023-03-22"), "闰二月");
});

test("非法日期不产生文案，不抛异常", () => {
  assert.equal(lunar.lunarCellLabel(""), "");
  assert.equal(lunar.lunarCellLabel("2024-02-30"), "");
  assert.equal(lunar.lunarCellLabel("not-a-date"), "");
});

test("月份标题给出该月农历月名，供日历标题使用", () => {
  assert.equal(lunar.lunarMonthCaption("2026-02-18"), "丙午 正月");
  // 闰月月份要带「闰」字。
  assert.equal(lunar.lunarMonthCaption("2023-03-22"), "癸卯 闰二月");
});
