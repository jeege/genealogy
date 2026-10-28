import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { toLunar } from "./lunar";

export type CalendarMode = "solar" | "lunar";

interface CalendarContextValue {
  /** 当前展示历法：公历或农历。 */
  mode: CalendarMode;
  setMode: (mode: CalendarMode) => void;
  toggleMode: () => void;
  /** 按当前历法格式化 ISO 日期；日期为空时返回占位或空串。 */
  formatDate: (iso: string | null | undefined, fallback?: string) => string;
}

const STORAGE_KEY = "calendar-mode";
const CalendarContext = createContext<CalendarContextValue | null>(null);

const MONTH_NAMES = ["正月", "二月", "三月", "四月", "五月", "六月", "七月", "八月", "九月", "十月", "冬月", "腊月"];
const DAY_DIGITS = ["", "一", "二", "三", "四", "五", "六", "七", "八", "九"];

function lunarDayText(day: number): string {
  if (day === 10) return "初十";
  if (day === 20) return "二十";
  if (day === 30) return "三十";
  if (day < 10) return `初${DAY_DIGITS[day]}`;
  if (day < 20) return `十${DAY_DIGITS[day - 10]}`;
  return `廿${DAY_DIGITS[day - 20]}`;
}

/**
 * 全站历法视图。默认农历；用户显式切换为公历后记住该选择。
 * 无论哪种展示，底层存储与接口始终是公历 ISO 日期。
 */
export function CalendarProvider({ children }: { children: React.ReactNode }) {
  const [mode, setModeState] = useState<CalendarMode>(() => {
    if (typeof window === "undefined") return "lunar";
    return window.localStorage.getItem(STORAGE_KEY) === "solar" ? "solar" : "lunar";
  });

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, mode);
    } catch {
      // 隐私模式下写入失败不影响本次会话。
    }
  }, [mode]);

  const setMode = useCallback((next: CalendarMode) => setModeState(next), []);
  const toggleMode = useCallback(
    () => setModeState((current) => (current === "lunar" ? "solar" : "lunar")),
    [],
  );

  const formatDate = useCallback(
    (iso: string | null | undefined, fallback = "-") => {
      if (!iso) return fallback;
      if (mode === "solar") {
        const [year, month, day] = iso.split("-");
        return `${year}年${month}月${day}日`;
      }
      const lunar = toLunar(iso);
      if (!lunar) return fallback;
      const monthName = `${lunar.leap ? "闰" : ""}${MONTH_NAMES[lunar.month - 1]}`;
      return `${lunar.stemBranch ?? ""}年${monthName}${lunarDayText(lunar.day)}`;
    },
    [mode],
  );

  const value = useMemo(
    () => ({ mode, setMode, toggleMode, formatDate }),
    [mode, setMode, toggleMode, formatDate],
  );

  return <CalendarContext.Provider value={value}>{children}</CalendarContext.Provider>;
}

export function useCalendar(): CalendarContextValue {
  const context = useContext(CalendarContext);
  if (!context) throw new Error("useCalendar 必须在 CalendarProvider 内使用");
  return context;
}
