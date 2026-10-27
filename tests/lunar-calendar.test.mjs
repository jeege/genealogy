import assert from "node:assert/strict";
import { test } from "node:test";
import { loadTypeScript } from "./helpers/load-typescript.mjs";

const lunar = loadTypeScript("src/lib/calendar/lunar.ts");

test("公历转农历：春节与国庆等已知日期", () => {
  assert.deepEqual(
    { ...lunar.toLunar("2024-02-10"), stemBranch: undefined },
    { year: 2024, month: 1, leap: false, day: 1, stemBranch: undefined },
  );
  const nationalDay = lunar.toLunar("1949-10-01");
  assert.equal(nationalDay.month, 8);
  assert.equal(nationalDay.day, 10);
  assert.equal(nationalDay.stemBranch, "己丑");
});

test("农历转公历：正月与闰月均能正确回算", () => {
  assert.equal(lunar.fromLunar({ year: 2024, month: 1, leap: false, day: 1 }), "2024-02-10");
  // 2023 年闰二月：闰二月初一 = 2023-03-22
  assert.equal(lunar.fromLunar({ year: 2023, month: 2, leap: true, day: 1 }), "2023-03-22");
  // 2023 年闰二月从 3-22 开始，持续到 4-19；非闰二月十三 = 3-04。
  assert.equal(lunar.fromLunar({ year: 2023, month: 2, leap: false, day: 13 }), "2023-03-04");
  // 农历年的腊月可落在次年公历：2023 年腊月三十 = 2024-02-09。
  assert.equal(lunar.fromLunar({ year: 2023, month: 12, leap: false, day: 30 }), "2024-02-09");
});

test("双向转换对近几十年逐日自洽", () => {
  // 抽取若干年份做全量往返：农历 -> 公历 -> 农历必须一致。
  for (const year of [1950, 1966, 2000, 2023, 2024]) {
    for (const month of lunar.lunarMonthsOf(year)) {
      for (const day of [1, 5, 15, 29]) {
        const iso = lunar.fromLunar({ year, month: month.month, leap: month.leap, day });
        if (!iso) continue; // 小月没有三十/廿九
        const back = lunar.toLunar(iso);
        assert.equal(back.year, year, `${iso} 年份`);
        assert.equal(back.month, month.month, `${iso} 月份`);
        assert.equal(back.leap, month.leap, `${iso} 闰月`);
        assert.equal(back.day, day, `${iso} 日`);
      }
    }
  }
});

test("闰月年份的月份列表包含闰月且不重复", () => {
  const months2023 = lunar.lunarMonthsOf(2023);
  assert.equal(months2023.filter((m) => m.leap).length, 1);
  assert.equal(months2023.find((m) => m.leap).label, "闰二月");
  assert.equal(new Set(months2023.map((m) => m.key)).size, months2023.length);
  // 腊月可能落在次年公历，仍应属于该农历年。
  assert.ok(months2023.some((m) => m.label === "腊月"));
});

test("非法日期返回 null，不做静默进位", () => {
  assert.equal(lunar.toLunar("2024-02-30"), null);
  assert.equal(lunar.toLunar("not-a-date"), null);
  assert.equal(lunar.fromLunar({ year: 2024, month: 2, leap: true, day: 1 }), null);
  assert.equal(lunar.fromLunar({ year: 2024, month: 13, leap: false, day: 1 }), null);
  // 2024 年正月只有 29 天，因此「正月三十」不存在。
  assert.equal(lunar.fromLunar({ year: 2024, month: 1, leap: false, day: 30 }), null);
});

test("农历日的中文写法", () => {
  const cases = { 1: "初一", 9: "初九", 10: "初十", 15: "十五", 20: "二十", 21: "廿一", 29: "廿九", 30: "三十" };
  for (const [day, expected] of Object.entries(cases)) {
    assert.equal(lunar.chineseDay(Number(day)), expected);
  }
});

test("格式化包含干支与闰月信息", () => {
  assert.equal(lunar.formatLunar(lunar.toLunar("2024-02-10")), "甲辰年正月初一");
  assert.equal(lunar.formatLunar(lunar.toLunar("2023-03-22")), "癸卯年闰二月初一");
  assert.match(lunar.formatISODateAsLunar("2024-02-10"), /甲辰年正月初一（2024-02-10）/);
});
