/**
 * 农历（中国历法）与公历的互转。
 *
 * 存储策略不变：数据库和接口始终使用 `YYYY-MM-DD` 的公历日期，
 * 农历只是输入与展示层的一种视图。这样既不影响既有数据、统计与 GEDCOM
 * 导出，也避免了历法换算差异被写进数据库。
 *
 * 实现基于浏览器/Node 的 `Intl` 中国历法支持（ICU 数据），不依赖额外依赖。
 */

export interface LunarDate {
  /** 农历年（以正月为界的年份，如 2024）。 */
  year: number;
  /** 月份 1-12。 */
  month: number;
  /** 是否为闰月，如 2023 年闰二月。 */
  leap: boolean;
  /** 当月第几天（1-30）。 */
  day: number;
  /** 干支纪年，如「甲辰」。 */
  stemBranch?: string;
}

export interface LunarMonthOption {
  /** 唯一键，用于下拉选择，如 "2" 或 "2L"。 */
  key: string;
  month: number;
  leap: boolean;
  /** 展示名，如「二月」「闰二月」。 */
  label: string;
}

// Intl 输出「十一月」，民间也写「冬月」；两种写法都接受。
const MONTH_NAMES = ["正月", "二月", "三月", "四月", "五月", "六月", "七月", "八月", "九月", "十月", "十一月", "腊月"];
const MONTH_ALIASES: Record<string, number> = { 冬月: 11, 十一月: 11, 腊月: 12, 十二月: 12 };

/** 解析 Intl 的月份标签，返回 1-12；无法识别时返回 0。 */
function monthFromLabel(label: string): number {
  const cleaned = label.replace(/^闰/, "");
  const byName = MONTH_NAMES.indexOf(cleaned);
  if (byName >= 0) return byName + 1;
  return MONTH_ALIASES[cleaned] ?? 0;
}
// 闰月沿用被闰月份的称呼，例如「闰二月」。
const LUNAR_MONTH_FORMATTER = new Intl.DateTimeFormat("zh-CN-u-ca-chinese", {
  year: "numeric",
  month: "long",
  day: "numeric",
  timeZone: "UTC",
});

/** 解析 ISO 日期为 UTC 时间戳，非法日期返回 null。 */
export function parseISODate(iso: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  // 拒绝 2023-02-30 这类自动进位的日期。
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return null;
  }
  return date;
}

/** 把 Date 格式化为 ISO 日期（UTC）。 */
export function formatISODate(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

const DAY_MS = 86_400_000;

// Intl.formatToParts 是农历换算里最贵的一步；同一天会被反复查询
// （二分查找、月份索引、往返校验），按 ISO 字符串缓存结果。
const lunarCache = new Map<string, LunarDate | null>();

/** 公历 ISO 日期 → 农历；非法日期返回 null。 */
export function toLunar(iso: string): LunarDate | null {
  const cached = lunarCache.get(iso);
  if (cached !== undefined) return cached;

  const date = parseISODate(iso);
  if (!date) {
    lunarCache.set(iso, null);
    return null;
  }
  const parts = LUNAR_MONTH_FORMATTER.formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  const relatedYear = get("relatedYear") || get("year");
  const year = Number(relatedYear);
  if (!Number.isFinite(year)) {
    lunarCache.set(iso, null);
    return null;
  }

  const monthLabel = get("month");
  const leap = monthLabel.startsWith("闰");
  const month = monthFromLabel(monthLabel);
  const day = Number(get("day"));
  if (!month || !day) {
    lunarCache.set(iso, null);
    return null;
  }
  const result = { year, month, leap, day, stemBranch: get("yearName") || undefined };
  lunarCache.set(iso, result);
  return result;
}

/** 只看「哪个月」的键：月 + 闰月标记（不含日），用于判断月份是否切换。 */
function lunarMonthKey(lunar: LunarDate): number {
  return lunar.month * 100 + (lunar.leap ? 1 : 0) * 50;
}

/** UTC 时间戳 → 整数「天序号」，便于用整数做二分查找。 */
function dayOf(time: number): number {
  return Math.round(time / DAY_MS);
}

function isoOfDay(day: number): string {
  return formatISODate(new Date(day * DAY_MS));
}

/** 某一农历月的起始与天数，对应 lunar-javascript 的 LunarMonth。 */
export interface LunarMonthSpan {
  /** 月份键，如 "2" 或 "2L"。 */
  key: string;
  month: number;
  leap: boolean;
  /** 该月第一天的天序号（公历）。 */
  firstDay: number;
  /** 该月天数，29 或 30。 */
  dayCount: number;
  /** 展示名，如「二月」「闰二月」。 */
  label: string;
}

/** 某一农历年的完整月表，对应 lunar-javascript 的 LunarYear。 */
export interface LunarYearIndex {
  year: number;
  /** 正月初一（春节）的天序号。 */
  newYearDay: number;
  /** 按公历顺序排列的月份，含闰月。 */
  months: LunarMonthSpan[];
}

/**
 * 农历年索引：按年把每个月的「首日 + 天数」一次算清并缓存。
 *
 * 这是 lunar-javascript 的模型（`LunarYear` 持有各 `LunarMonth`，每月带
 * `firstJulianDay` 与 `dayCount`），好处是正反两个方向都退化成查表：
 * - 农历 → 公历：月份首日 + (日 - 1)，无需搜索；
 * - 公历 → 农历：二分命中月份区间即可。
 *
 * 与 lunar-javascript 的差别只在数据来源：它用寿星天文历计算真实朔望
 * （`ShouXingUtil.calcShuo`）并据此定月首与闰月，本项目沿用 `Intl` 的
 * 中国历法数据（ICU），不引入天文历算法与 435KB 依赖，避免自行实现
 * 章动/ΔT 带来的正确性风险。
 */
const yearIndexCache = new Map<number, LunarYearIndex>();

const newYearCache = new Map<number, number>();

/** 二分：农历 year 年的正月初一天序号（结果按年缓存）。 */
function lunarNewYearDay(year: number): number {
  const cached = newYearCache.get(year);
  if (cached !== undefined) return cached;
  let low = dayOf(Date.UTC(year, 0, 1));
  // 春节最晚在 2 月 21 日，用 3 月 1 日作为上界必定满足。
  let high = dayOf(Date.UTC(year, 2, 1));
  while (low < high) {
    const mid = (low + high) >> 1;
    const lunar = toLunar(isoOfDay(mid));
    if (lunar && lunar.year >= year) {
      high = mid;
    } else {
      low = mid + 1;
    }
  }
  newYearCache.set(year, low);
  return low;
}

/**
 * 求下个月初一的天序号。
 *
 * 农历月长只有 29 或 30 天，所以下个月首一定落在 `[fromDay+29, fromDay+30]`。
 * 直接在 `fromDay+29` 起逐日确认「键是否已经改变」即可：最多看 2 天，
 * 比在整年上二分更省，也不会被闰月处键值跳变影响。
 */
function nextMonthStartDay(
  year: number,
  fromDay: number,
  currentMonthKey: number,
  endDay: number,
): number {
  for (let offset = 29; offset <= 30; offset += 1) {
    const day = fromDay + offset;
    if (day >= endDay) return endDay;
    const lunar = toLunar(isoOfDay(day));
    if (!lunar || lunar.year !== year) return endDay;
    // 比较「月份键」而非完整键：同月内日号本来就会变。
    if (lunarMonthKey(lunar) !== currentMonthKey) return day;
  }
  return endDay;
}

/** 取（或建立）农历年的月表。 */
export function lunarYearIndex(year: number): LunarYearIndex {
  const cached = yearIndexCache.get(year);
  if (cached) return cached;

  const months: LunarMonthSpan[] = [];
  const newYearDay = lunarNewYearDay(year);
  const endDay = lunarNewYearDay(year + 1);

  // 从春节起逐月推进：本月首日已知，下个月首用 3 天窗口二分求出，
  // 两者之差即本月天数。最多 13 个月（含闰月），循环有上限保护。
  let startDay = newYearDay;
  for (let guard = 0; guard < 14 && startDay < endDay; guard += 1) {
    const sample = toLunar(isoOfDay(startDay));
    // 首日必须确实属于本年，否则说明索引边界异常。
    if (!sample || sample.year !== year) break;

    const nextDay = nextMonthStartDay(year, startDay, lunarMonthKey(sample), endDay);
    const dayCount = nextDay - startDay;
    // 农历月只能是 29 或 30 天；异常时停止，避免产出错误月份表。
    if (dayCount < 29 || dayCount > 30) break;

    months.push({
      key: `${sample.month}${sample.leap ? "L" : ""}`,
      month: sample.month,
      leap: sample.leap,
      firstDay: startDay,
      dayCount,
      // 十一月同时给出「冬月」别名，符合族谱常见写法。
      label: `${sample.leap ? "闰" : ""}${sample.month === 11 ? "冬月" : MONTH_NAMES[sample.month - 1]}`,
    });
    startDay = nextDay;
  }

  const index = { year, newYearDay, months };
  yearIndexCache.set(year, index);
  return index;
}

/**
 * 农历 → 公历 ISO 日期。该农历日期不存在（如闰月写错、小月三十）时返回 null。
 *
 * 与 lunar-javascript 的 `Lunar.fromYmd` 一致：先取该月首日儒略日/天序号，
 * 加上 (日 - 1)，并校验「日」不超过该月天数。
 */
export function fromLunar(lunar: LunarDate): string | null {
  if (!Number.isFinite(lunar.year) || lunar.month < 1 || lunar.month > 12) return null;
  if (!Number.isFinite(lunar.day) || lunar.day < 1 || lunar.day > 30) return null;

  const span = lunarYearIndex(lunar.year).months.find(
    (item) => item.month === lunar.month && item.leap === lunar.leap,
  );
  // 该年不存在这个月（如 2024 年没有闰二月），或该月没有第 day 天。
  if (!span) return null;
  if (lunar.day > span.dayCount) return null;
  return isoOfDay(span.firstDay + lunar.day - 1);
}

/** 某一农历年可选的月份列表（含闰月）。 */
export function lunarMonthsOf(year: number): LunarMonthOption[] {
  if (!Number.isFinite(year)) return [];
  return lunarYearIndex(year).months.map(({ key, month, leap, label }) => ({
    key,
    month,
    leap,
    label,
  }));
}

/** 某个农历月有多少天（29 或 30）；该年没有这个月时返回 0。 */
export function lunarDayCountOf(year: number, month: number, leap = false): number {
  if (!Number.isFinite(year)) return 0;
  const span = lunarYearIndex(year).months.find(
    (item) => item.month === month && item.leap === leap,
  );
  return span?.dayCount ?? 0;
}

/** 格式化农历为中文展示，如「甲辰年闰二月十五」。缺少干支时退回公历年份。 */
export function formatLunar(lunar: LunarDate): string {
  const suffix = lunar.leap ? "闰" : "";
  // 注意：干支分支自己带「年」，普通年份分支也要带，避免出现「2024年年」。
  const yearPrefix = lunar.stemBranch ? `${lunar.stemBranch}年` : `${lunar.year}年`;
  const monthName = lunar.month === 11 ? "冬月" : MONTH_NAMES[lunar.month - 1];
  return `${yearPrefix}${suffix}${monthName}${chineseDay(lunar.day)}`;
}

const DIGITS = ["", "一", "二", "三", "四", "五", "六", "七", "八", "九"];

/** 农历日的中文写法：初一、十五、廿三、三十。 */
export function chineseDay(day: number): string {
  if (day <= 0 || day > 30) return String(day);
  if (day === 10) return "初十";
  if (day === 20) return "二十";
  if (day === 30) return "三十";
  if (day < 10) return `初${DIGITS[day]}`;
  if (day < 20) return `十${DIGITS[day - 10]}`;
  return `廿${DIGITS[day - 20]}`;
}

/** 公历 ISO → 农历展示文本；闰月与生肖信息完整保留。 */
export function formatISODateAsLunar(iso: string): string | null {
  const lunar = toLunar(iso);
  if (!lunar) return null;
  return `${formatLunar(lunar)}（${iso}）`;
}

/** 当前可选的农历年份范围，覆盖族谱中常见的近现代年份。 */
export function lunarYearRange(referenceYear = new Date().getFullYear()): { min: number; max: number } {
  return { min: 1800, max: referenceYear + 1 };
}

/** 农历日的短写法：初一显示月份名（如「正月」），其余显示「初五」「廿三」。 */
export function lunarDayLabel(lunar: LunarDate): string {
  if (lunar.day === 1) {
    return `${lunar.leap ? "闰" : ""}${lunar.month === 11 ? "冬月" : MONTH_NAMES[lunar.month - 1]}`;
  }
  return chineseDay(lunar.day);
}

/** 节气的公历月日（近似固定日期），用于日历格内的节气提示。 */
const SOLAR_TERMS: Array<{ name: string; month: number; day: number }> = [
  { name: "小寒", month: 1, day: 5 },
  { name: "大寒", month: 1, day: 20 },
  { name: "立春", month: 2, day: 4 },
  { name: "雨水", month: 2, day: 19 },
  { name: "惊蛰", month: 3, day: 5 },
  { name: "春分", month: 3, day: 20 },
  { name: "清明", month: 4, day: 4 },
  { name: "谷雨", month: 4, day: 20 },
  { name: "立夏", month: 5, day: 5 },
  { name: "小满", month: 5, day: 21 },
  { name: "芒种", month: 6, day: 5 },
  { name: "夏至", month: 6, day: 21 },
  { name: "小暑", month: 7, day: 7 },
  { name: "大暑", month: 7, day: 22 },
  { name: "立秋", month: 8, day: 7 },
  { name: "处暑", month: 8, day: 23 },
  { name: "白露", month: 9, day: 7 },
  { name: "秋分", month: 9, day: 23 },
  { name: "寒露", month: 10, day: 8 },
  { name: "霜降", month: 10, day: 23 },
  { name: "立冬", month: 11, day: 7 },
  { name: "小雪", month: 11, day: 22 },
  { name: "大雪", month: 12, day: 7 },
  { name: "冬至", month: 12, day: 22 },
];

/** 农历节日的农历月日（固定），用于日历格内提示。 */
const LUNAR_FESTIVALS: Array<{
  name: string;
  month: number;
  day: number;
  /** 是否只在非闰月生效（如除夕、中秋）。 */
  skipLeap?: boolean;
}> = [
  { name: "春节", month: 1, day: 1 },
  { name: "元宵", month: 1, day: 15 },
  { name: "龙抬头", month: 2, day: 2 },
  { name: "端午", month: 5, day: 5 },
  { name: "七夕", month: 7, day: 7 },
  { name: "中元", month: 7, day: 15 },
  { name: "中秋", month: 8, day: 15, skipLeap: true },
  { name: "重阳", month: 9, day: 9 },
  { name: "腊八", month: 12, day: 8 },
  { name: "小年", month: 12, day: 23 },
];

/** 公历节日（固定月日）。 */
const SOLAR_FESTIVALS: Array<{ name: string; month: number; day: number }> = [
  { name: "元旦", month: 1, day: 1 },
  { name: "妇女节", month: 3, day: 8 },
  { name: "劳动节", month: 5, day: 1 },
  { name: "儿童节", month: 6, day: 1 },
  { name: "国庆节", month: 10, day: 1 },
  { name: "圣诞", month: 12, day: 25 },
];

/**
 * 日历格内的第二行文案：优先显示节日/节气，否则显示农历日。
 *
 * 与常见的中文日历一致：公历数字在上，农历或节日在下。
 * 传入的 ISO 日期非法时返回空串。
 */
export function lunarCellLabel(iso: string): string {
  const lunar = toLunar(iso);
  if (!lunar) return "";
  const month = Number(iso.slice(5, 7));
  const day = Number(iso.slice(8, 10));

  const solarFestival = SOLAR_FESTIVALS.find((f) => f.month === month && f.day === day);
  if (solarFestival) return solarFestival.name;

  // 除夕：腊月的最后一天，需按当年腊月天数判断。
  const lastMonth = lunarYearIndex(lunar.year).months.at(-1);
  if (
    lastMonth &&
    lunar.month === lastMonth.month &&
    !lunar.leap &&
    lunar.day === lastMonth.dayCount
  ) {
    return "除夕";
  }

  const term = SOLAR_TERMS.find((t) => t.month === month && t.day === day);
  if (term) return term.name;

  const festival = LUNAR_FESTIVALS.find(
    (f) => f.month === lunar.month && f.day === lunar.day && !(f.skipLeap && lunar.leap),
  );
  if (festival) return festival.name;

  return lunarDayLabel(lunar);
}

/** 日历标题的农历副标题，如「甲辰年 正月初一」。 */
export function lunarMonthCaption(iso: string): string {
  const lunar = toLunar(iso);
  if (!lunar) return "";
  return `${lunar.stemBranch ?? `${lunar.year}年`} ${lunar.leap ? "闰" : ""}${
    lunar.month === 11 ? "冬月" : MONTH_NAMES[lunar.month - 1]
  }`;
}

/** 年份下拉的可加载区间（可为负，表示公元前）。 */
export interface YearWindow {
  min: number;
  max: number;
}

/** 逐年加载的下限/上限，避免无限增长成不可用的超大列表。 */
export const YEAR_WINDOW_LIMITS = { min: -2000, max: 9999 } as const;

/** 年份列表默认展示「当前年份 ±50 年」，避免一屏冗长的年份列表。 */
export const YEAR_WINDOW_SPAN = 50;

/**
 * 以某个年份为中心构造年份窗口。
 *
 * 结果会被夹在 {@link YEAR_WINDOW_LIMITS} 之内，避免超出可处理的历法范围。
 */
export function yearWindowAround(centerYear: number, span = YEAR_WINDOW_SPAN): YearWindow {
  return {
    min: Math.max(YEAR_WINDOW_LIMITS.min, centerYear - span),
    max: Math.min(YEAR_WINDOW_LIMITS.max, centerYear + span),
  };
}

/** 年份窗口每次追加的年份数，滚动到边界时使用。 */
export const YEAR_WINDOW_BATCH = 50;

/**
 * 向指定方向扩展年份窗口。
 *
 * 到达 {@link YEAR_WINDOW_LIMITS} 边界后返回同一对象引用，
 * 便于 React 跳过无意义的重渲染。
 */
export function expandYearWindow(
  window: YearWindow,
  direction: "earlier" | "later",
  batch = YEAR_WINDOW_BATCH,
): YearWindow {
  if (direction === "earlier") {
    const min = Math.max(YEAR_WINDOW_LIMITS.min, window.min - batch);
    return min === window.min ? window : { ...window, min };
  }
  const max = Math.min(YEAR_WINDOW_LIMITS.max, window.max + batch);
  return max === window.max ? window : { ...window, max };
}

/** 生成降序的年份列表（最近年份在前，便于直接定位当前年）。 */
export function yearOptionsOf(window: YearWindow): number[] {
  const list: number[] = [];
  for (let year = window.max; year >= window.min; year -= 1) list.push(year);
  return list;
}
