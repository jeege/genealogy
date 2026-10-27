import { CalendarDays, CalendarRange } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useCalendar } from "@/lib/calendar/calendar-context";

/**
 * 历法切换：在公历与农历之间切换日期展示。
 * 只影响显示，数据库与接口仍然是公历 ISO 日期。
 */
export function CalendarSwitcher() {
  const { mode, toggleMode } = useCalendar();
  const isLunar = mode === "lunar";
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={toggleMode}
      title={isLunar ? "当前显示农历，点击切换为公历" : "当前显示公历，点击切换为农历"}
      aria-label={isLunar ? "切换到公历" : "切换到农历"}
      className="gap-1.5 px-2"
    >
      {isLunar ? (
        <CalendarRange className="h-4 w-4 text-muted-foreground" />
      ) : (
        <CalendarDays className="h-4 w-4 text-muted-foreground" />
      )}
      <span className="hidden sm:inline text-xs">{isLunar ? "农历" : "公历"}</span>
    </Button>
  );
}
