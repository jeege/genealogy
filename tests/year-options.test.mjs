import assert from "node:assert/strict";
import { test } from "node:test";
import { loadTypeScript } from "./helpers/load-typescript.mjs";

const lunar = loadTypeScript("src/lib/calendar/lunar.ts");

test("年份列表降序生成,便于直接定位当前年份", () => {
  const options = lunar.yearOptionsOf({ min: 2024, max: 2026 });
  assert.deepEqual(options, [2026, 2025, 2024]);
});

test("年份区间覆盖公元前到公元后", () => {
  const { min, max } = lunar.YEAR_WINDOW_LIMITS;
  assert.ok(min < 0, "下限应支持公元前");
  assert.ok(max >= 2100, "上限应覆盖远期");
  const options = lunar.yearOptionsOf({ min, max });
  assert.equal(options.length, max - min + 1);
  assert.equal(options[0], max, "首项应为最大年份");
  assert.equal(options[options.length - 1], min, "末项应为最小年份");
});
