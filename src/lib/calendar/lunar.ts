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

/** 公历 ISO 日期 → 农历；非法日期返回 null。 */
export function toLunar(iso: string): LunarDate | null {
  const date = parseISODate(iso);
  if (!date) return null;
  const parts = LUNAR_MONTH_FORMATTER.formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  const relatedYear = get("relatedYear") || get("year");
  const year = Number(relatedYear);
  if (!Number.isFinite(year)) return null;

  const monthLabel = get("month");
  const leap = monthLabel.startsWith("闰");
  const month = monthFromLabel(monthLabel);
  const day = Number(get("day"));
  if (!month || !day) return null;
  return { year, month, leap, day, stemBranch: get("yearName") || undefined };
}

/** 农历 → 公历 ISO 日期。该农历日期不存在（如闰月写错、小月三十）时返回 null。 */
export function fromLunar(lunar: LunarDate): string | null {
  if (!Number.isFinite(lunar.year) || lunar.month < 1 || lunar.month > 12) return null;
  if (!Number.isFinite(lunar.day) || lunar.day < 1 || lunar.day > 30) return null;

  // 农历年 Y 覆盖公历 Y 年春节到 Y+1 年春节前一天，可能跨两个公历年：
  // 搜索 [Y-01-01, Y+1-03-01) 并按 relatedYear 过滤，避免把相邻年份的同月混进来。
  const start = Date.UTC(lunar.year, 0, 1);
  const end = Date.UTC(lunar.year + 1, 2, 1);
  const candidates: string[] = [];
  for (let time = start; time < end; time += 86_400_000) {
    const iso = formatISODate(new Date(time));
    const converted = toLunar(iso);
    if (!converted) continue;
    if (converted.year !== lunar.year) continue;
    if (converted.month === lunar.month && converted.leap === lunar.leap) {
      candidates.push(iso);
    }
  }
  // 该月的第 day 天：候选按日期升序，索引 day-1。
  return candidates[lunar.day - 1] ?? null;
}

/** 某一农历年可选的月份列表（含闰月）。 */
export function lunarMonthsOf(year: number): LunarMonthOption[] {
  if (!Number.isFinite(year)) return [];
  const options: LunarMonthOption[] = [];
  const seen = new Set<string>();
  const start = Date.UTC(year, 0, 1);
  const end = Date.UTC(year + 1, 2, 1);
  for (let time = start; time < end; time += 86_400_000) {
    const converted = toLunar(formatISODate(new Date(time)));
    if (!converted || converted.year !== year) continue;
    const key = `${converted.month}${converted.leap ? "L" : ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    options.push({
      key,
      month: converted.month,
      leap: converted.leap,
      // 十一月同时给出「冬月」别名，符合族谱常见写法。
      label: `${converted.leap ? "闰" : ""}${converted.month === 11 ? "冬月" : MONTH_NAMES[converted.month - 1]}`,
    });
  }
  return options;
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
