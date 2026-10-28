import assert from "node:assert/strict";
import { test } from "node:test";
import { loadTypeScript } from "./helpers/load-typescript.mjs";

const lunar = loadTypeScript("src/lib/calendar/lunar.ts");

/**
 * 回归:农历状态下打开编辑成员弹窗明显卡顿。
 *
 * 原因有两个:
 * 1. fromLunar / lunarMonthsOf 都按「逐日扫描整年」实现,每年约 425 次
 *    Intl.formatToParts,单个字段就要 25~28ms;弹窗里生日/卒年各一个,
 *    首帧同步阻塞 ~100ms。
 * 2. 换算结果没有缓存,表单里任何字段变动都会重算。
 *
 * 下面既锁住正确性(二进制搜索不能改变结果),也锁住复杂度(不能退回逐日扫描)。
 */

test("农历转公历与逐日扫描的结果完全一致", () => {
  // 以逐日扫描作为参照实现,覆盖含闰月的年份与普通年份。
  const reference = (year, month, leap, day) => {
    const start = Date.UTC(year, 0, 1);
    const end = Date.UTC(year + 1, 2, 1);
    const candidates = [];
    for (let time = start; time < end; time += 86_400_000) {
      const date = new Date(time);
      const iso = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
      const converted = lunar.toLunar(iso);
      if (!converted || converted.year !== year) continue;
      if (converted.month === month && converted.leap === leap) candidates.push(iso);
    }
    return candidates[day - 1] ?? null;
  };

  for (const year of [2023, 2024, 1950]) {
    for (const option of lunar.lunarMonthsOf(year)) {
      for (const day of [1, 15, 29, 30]) {
        assert.equal(
          lunar.fromLunar({ year, month: option.month, leap: option.leap, day }),
          reference(year, option.month, option.leap, day),
          `${year}-${option.key}-${day} 换算不一致`,
        );
      }
    }
  }
});

test("月份列表与逐日扫描得到的月份集合一致", () => {
  const referenceMonths = (year) => {
    const start = Date.UTC(year, 0, 1);
    const end = Date.UTC(year + 1, 2, 1);
    const keys = new Set();
    for (let time = start; time < end; time += 86_400_000) {
      const date = new Date(time);
      const iso = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
      const converted = lunar.toLunar(iso);
      if (!converted || converted.year !== year) continue;
      keys.add(`${converted.month}${converted.leap ? "L" : ""}`);
    }
    return [...keys].sort();
  };

  for (const year of [2023, 2024, 1900, 1950]) {
    assert.deepEqual(
      lunar.lunarMonthsOf(year).map((item) => item.key).sort(),
      referenceMonths(year),
      `${year} 年月份列表不一致`,
    );
  }
});

test("首次换算不再是逐日扫描的量级，且同年重复调用命中缓存", () => {
  const year = 1937;
  const t0 = performance.now();
  lunar.lunarMonthsOf(year);
  lunar.fromLunar({ year, month: 4, leap: false, day: 12 });
  const first = performance.now() - t0;

  const t1 = performance.now();
  for (let i = 0; i < 200; i += 1) {
    lunar.lunarMonthsOf(year);
    lunar.fromLunar({ year, month: 4, leap: false, day: 12 });
  }
  const repeat = performance.now() - t1;

  // 逐日扫描实现下,单年首次约 25~28ms;留出宽松余量避免 CI 抖动误报。
  assert.ok(first < 25, `首次换算耗时 ${first.toFixed(1)}ms,疑似退回逐日扫描`);
  // 命中缓存后应远快于首次。
  assert.ok(repeat < first * 5, `缓存未生效:首次 ${first.toFixed(1)}ms,200 次 ${repeat.toFixed(1)}ms`);
});
