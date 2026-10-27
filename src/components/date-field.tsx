import * as React from "react";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { useCalendar } from "@/lib/calendar/calendar-context";
import {
  chineseDay,
  formatLunar,
  fromLunar,
  lunarMonthsOf,
  lunarYearRange,
  toLunar,
  type LunarDate,
} from "@/lib/calendar/lunar";
import { cn } from "@/lib/utils";

interface DateFieldProps {
  id?: string;
  /** 公历 ISO 日期（YYYY-MM-DD），即存储值。 */
  value: string;
  onChange: (iso: string) => void;
  className?: string;
  disabled?: boolean;
}

/**
 * 日期输入：跟随全站历法切换。
 *
 * - 公历模式使用原生 date 输入；
 * - 农历模式提供年/月（含闰月）/日下拉，换算后仍写回公历 ISO 字符串，
 *   数据库存储格式完全不变。
 */
export function DateField({ id, value, onChange, className, disabled }: DateFieldProps) {
  const { mode } = useCalendar();
  return mode === "lunar" ? (
    <LunarDateInput id={id} value={value} onChange={onChange} className={className} disabled={disabled} />
  ) : (
    <Input
      id={id}
      type="date"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className={className}
      disabled={disabled}
    />
  );
}

function LunarDateInput({ id, value, onChange, className, disabled }: DateFieldProps) {
  const current = toLunar(value);
  const range = lunarYearRange();
  const [year, setYear] = React.useState<number>(current?.year ?? range.max);
  const [monthKey, setMonthKey] = React.useState<string>(
    current ? `${current.month}${current.leap ? "L" : ""}` : "1",
  );
  const [day, setDay] = React.useState<number>(current?.day ?? 1);
  const [error, setError] = React.useState<string | null>(null);

  // 外部值变化（例如打开另一位成员的编辑框）时同步到本地控件。
  React.useEffect(() => {
    const lunar = toLunar(value);
    if (!lunar) return;
    setYear(lunar.year);
    setMonthKey(`${lunar.month}${lunar.leap ? "L" : ""}`);
    setDay(lunar.day);
    setError(null);
  }, [value]);

  const months = React.useMemo(() => lunarMonthsOf(year), [year]);
  const selectedMonth = months.find((item) => item.key === monthKey) ?? months[0];

  React.useEffect(() => {
    // 换年后如果当前月份不在新一年（例如闰月），回退到正月。
    if (months.length > 0 && !months.some((item) => item.key === monthKey)) {
      setMonthKey(months[0].key);
    }
  }, [months, monthKey]);

  const lunar: LunarDate | null =
    selectedMonth === undefined
      ? null
      : { year, month: selectedMonth.month, leap: selectedMonth.leap, day };
  const converted = lunar ? fromLunar(lunar) : null;

  // 只要本地选择变化就写回公历 ISO；无效农历日期（如小月三十）给出提示。
  React.useEffect(() => {
    if (!lunar) return;
    if (!converted) {
      setError("该农历日期不存在（可能是小月或闰月），请重新选择");
      return;
    }
    setError(null);
    if (converted !== value) onChange(converted);
    // onChange 由父组件提供，这里只依赖选择值本身。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year, monthKey, day, converted]);

  const years = React.useMemo(() => {
    const list: number[] = [];
    for (let y = range.min; y <= range.max; y += 1) list.push(y);
    return list.reverse();
  }, [range.min, range.max]);

  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <div className="flex flex-col sm:flex-row gap-2">
        <Select
          value={String(year)}
          onValueChange={(next) => setYear(Number(next))}
          disabled={disabled}
        >
          <SelectTrigger className="sm:w-32" aria-label="农历年份">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="max-h-72">
            {years.map((item) => (
              <SelectItem key={item} value={String(item)}>
                {item}年
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={selectedMonth?.key ?? "1"}
          onValueChange={setMonthKey}
          disabled={disabled}
        >
          <SelectTrigger className="sm:w-28" aria-label="农历月份">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {months.map((item) => (
              <SelectItem key={item.key} value={item.key}>
                {item.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={String(day)} onValueChange={(next) => setDay(Number(next))} disabled={disabled}>
          <SelectTrigger className="sm:w-24" aria-label="农历日">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Array.from({ length: 30 }, (_, index) => index + 1).map((item) => (
              <SelectItem key={item} value={String(item)}>
                {chineseDay(item)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex items-center justify-between gap-2 min-h-5">
        <p className={cn("text-xs", error ? "text-destructive" : "text-muted-foreground")}>
          {error ??
            (converted
              ? // 换算后的公历日期回查农历，能得到干支，避免提示里出现重复的「年」。
                `${formatLunar(toLunar(converted) ?? lunar!)} → ${converted}`
              : "选择农历日期后自动换算公历")}
        </p>
        {value && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-xs"
            onClick={() => onChange("")}
            disabled={disabled}
            id={id ? `${id}-clear` : undefined}
          >
            清除
          </Button>
        )}
      </div>
    </div>
  );
}
