import * as React from "react";
import { CalendarDays, ChevronDown, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import type { DayButton, DropdownProps, MonthCaption } from "react-day-picker";
import { useCalendar } from "@/lib/calendar/calendar-context";
import {
  expandYearWindow,
  formatLunar,
  yearOptionsOf,
  yearWindowAround,
  type YearWindow,
  lunarCellLabel,
  lunarMonthCaption,
  parseISODate,
  toLunar,
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

/** ISO 字符串 → DayPicker 使用的本地 Date（避免时区把日期挪一天）。 */
function isoToLocalDate(iso: string): Date | undefined {
  const parsed = parseISODate(iso);
  if (!parsed) return undefined;
  // parseISODate 返回 UTC 午夜，换成同一日历日的本地时间。
  return new Date(parsed.getUTCFullYear(), parsed.getUTCMonth(), parsed.getUTCDate());
}

function localDateToISO(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** 农历日/节日文案是否应当高亮（节日、节气用强调色，普通农历日用次要色）。 */
function isHighlightedLabel(label: string): boolean {
  // 普通农历日以「初/十/廿/卅」开头，或为月名（正月、二月…）。
  return !/^[初十廿卅]|^(闰)?(正|二|三|四|五|六|七|八|九|十|冬|腊)月$/.test(label);
}

/** 兜底年份窗口与空回调，保持稳定引用。 */
/**
 * 年份列表的展开状态。放在模块级而非组件 state：
 * react-day-picker 在重新渲染时可能重建 MonthCaption 子树，
 * 组件内 state 会随卸载丢失（表现为「滚一下年份列表就消失」）。
 */
const yearListOpenState = { open: false };
/** 年份窗口同样放模块级：组件重建时保留已加载的范围。 */
const yearWindowState: { window: YearWindow | null } = { window: null };
const monthListOpenState = { open: false };

/**
 * 日历的自定义组件。必须是模块级常量：每次渲染新建组件类型会让 React
 * 卸载重建整棵子树，导致下拉等内部状态丢失。
 */
const calendarComponents = {
  DayButton: LunarDayButton,
  MonthCaption: LunarMonthCaption,
  YearsDropdown: YearDropdown,
  MonthsDropdown: MonthDropdown,
};

/**
 * 日期输入：公历与农历共用同一个日历弹层。
 *
 * 两种历法的交互完全一致（都是点日历选日期），只有输入框的文案不同：
 * - 公历模式：输入框显示 `2026-02-18`；
 * - 农历模式：输入框显示 `丙午年正月初二`。
 *
 * 日历格始终是「公历数字 + 农历日/节日」双行，与常见中文日历一致。
 * 底层始终以公历 ISO 字符串存取，数据库与接口格式不变。
 */
export function DateField({ id, value, onChange, className, disabled }: DateFieldProps) {
  const { mode } = useCalendar();
  const [open, setOpen] = React.useState(false);
  const rootRef = React.useRef<HTMLDivElement>(null);

  // 若本组件位于 Radix Dialog 内，弹层要挂到 DialogContent 上。
  //
  // Dialog 使用 react-remove-scroll 在 document 捕获阶段拦截 wheel，
  // 只放行 DialogContent 内部的滚动。Popover 默认 Portal 到 body，
  // 会落在白名单外，导致弹层里的列表无法用滚轮滚动（拖滚动条却能滚）。
  const portalContainer = React.useMemo(() => {
    if (typeof window === "undefined") return undefined;
    const dialog = rootRef.current?.closest("[data-slot=dialog-content]");
    return (dialog as HTMLElement | null) ?? undefined;
    // 依赖 open 是有意的：只在弹层打开时查找一次，避免每次渲染都读 DOM。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const selected = React.useMemo(() => isoToLocalDate(value), [value]);
  const lunar = React.useMemo(() => toLunar(value), [value]);

  // 打开时定位到所选日期（或今天）。
  const [month, setMonth] = React.useState<Date>(() => selected ?? new Date());
  React.useEffect(() => {
    if (selected) setMonth(selected);
  }, [selected]);

  const caption = selected
    ? mode === "lunar" && lunar
      ? formatLunar(lunar)
      : localDateToISO(selected)
    : "";

  const handleSelect = (next: Date | undefined) => {
    if (!next) return;
    onChange(localDateToISO(next));
    setOpen(false);
  };

  // 年份窗口：以当前日期所在年份为中心，滚动下拉时按批扩展。



  return (
    <div ref={rootRef} className={cn("flex items-center gap-1", className)}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            id={id}
            type="button"
            variant="outline"
            disabled={disabled}
            className={cn(
              "h-9 flex-1 justify-between gap-2 px-3 text-left font-normal",
              !caption && "text-muted-foreground",
            )}
          >
            <span className="truncate">{caption || "选择日期"}</span>
            <CalendarDays className="h-4 w-4 shrink-0 opacity-60" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          container={portalContainer}
          className="w-auto p-0"
          align="start"
          side="bottom"
          // 固定从下方展开；空间不足时由 Radix 整体平移，避免上下跳动。
          avoidCollisions={false}
          // 表单在滚动容器里时，让弹层跟随锚点。
          sticky="always"
          collisionPadding={12}
        >
          <Calendar
            mode="single"
            selected={selected}
            month={month}
            onMonthChange={setMonth}
            onSelect={handleSelect}
            captionLayout="dropdown"
            // 年份可无限下拉，因此这里只约束到最宽松的范围；
            // 真正的年份选项由自定义下拉控制。
            startMonth={new Date(-2000, 0, 1)}
            endMonth={new Date(9999, 11, 31)}
            formatters={{
              // 星期行改为中文。
              formatWeekdayName: (date) =>
                ["日", "一", "二", "三", "四", "五", "六"][date.getDay()],
            }}
            components={calendarComponents}
            autoFocus
          />
        </PopoverContent>
      </Popover>
      {value ? (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-9 w-9 shrink-0 text-muted-foreground hover:text-foreground"
          onClick={() => onChange("")}
          disabled={disabled}
          aria-label="清除日期"
          title="清除日期"
          id={id ? `${id}-clear` : undefined}
        >
          <X className="h-4 w-4" />
        </Button>
      ) : null}
    </div>
  );
}

/** 日期格：公历数字 + 农历日/节日副标题。 */
function LunarDayButton({ day, modifiers, className, ...props }: React.ComponentProps<typeof DayButton>) {
  const iso = localDateToISO(day.date);
  const label = lunarCellLabel(iso);

  const ref = React.useRef<HTMLButtonElement>(null);
  React.useEffect(() => {
    if (modifiers.focused) ref.current?.focus();
  }, [modifiers.focused]);

  return (
    <Button
      ref={ref}
      variant="ghost"
      size="icon"
      data-day={iso}
      data-selected-single={
        modifiers.selected &&
        !modifiers.range_start &&
        !modifiers.range_end &&
        !modifiers.range_middle
      }
      className={cn(
        "data-[selected-single=true]:bg-primary data-[selected-single=true]:text-primary-foreground group-data-[focused=true]/day:border-ring group-data-[focused=true]/day:ring-ring/50 flex h-11 w-full min-w-[--cell-size] flex-col items-center justify-center gap-0.5 rounded-md font-normal leading-none transition-colors hover:bg-accent group-data-[focused=true]/day:relative group-data-[focused=true]/day:z-10 group-data-[focused=true]/day:ring-[3px]",
        className,
      )}
      {...props}
    >
      <span className="text-xs tabular-nums">{day.date.getDate()}</span>
      <span
        className={cn(
          "text-[10px] leading-none data-[selected-single=true]:text-primary-foreground",
          isHighlightedLabel(label) ? "text-rose-600 dark:text-rose-400" : "text-muted-foreground",
        )}
      >
        {label}
      </span>
    </Button>
  );
}

/**
 * 月份标题：左边「月 + 年」两个下拉，其后是农历月名，右侧留给翻页按钮。
 *
 * 农历文案用 `whitespace-nowrap` 保持「壬子 九月」在一行内，
 * 右侧 `pr` 为导航按钮预留空间，避免被覆盖。
 */
function LunarMonthCaption({
  calendarMonth,
  displayIndex: _displayIndex,
  className,
  children,
  // displayIndex 是 react-day-picker 传给组件的内部字段，不是合法 DOM 属性，
  // 必须显式解构掉，否则会作为未知属性透传到 <div> 上并触发 React 警告。
  ...props
}: React.ComponentProps<typeof MonthCaption>) {
  const year = calendarMonth.date.getFullYear();
  const month = calendarMonth.date.getMonth() + 1;
  const lunarCaption = lunarMonthCaption(`${year}-${String(month).padStart(2, "0")}-15`);

  return (
    <div
      className={cn(
        // 右侧留出导航按钮的宽度（两个 2rem 按钮 + 间隙），避免文案被盖上。
        "flex min-h-[--cell-size] w-full items-center gap-2 pr-[4.5rem]",
        className,
      )}
      {...props}
    >
      <div className="flex min-w-0 items-center gap-1">{children}</div>
      {lunarCaption && (
        <span className="whitespace-nowrap text-xs text-muted-foreground">{lunarCaption}</span>
      )}
    </div>
  );
}

/** 下拉列表的固定行高（对应 Tailwind 的 h-8）。 */
const LIST_ROW_HEIGHT = 32;
/** 下拉列表的可视高度。 */
const LIST_HEIGHT = 256;

interface SelectOption {
  value: number;
  label: string;
  disabled?: boolean;
  /** 当前选中项，用于高亮。 */
  selected?: boolean;
}

interface SelectListProps {
  /** 触发器上显示的文字。 */
  label: string;
  /** 无障碍标签，如「选择年份」。 */
  ariaLabel: string;
  options: SelectOption[];
  /** 打开时定位到哪一项。 */
  activeValue: number;
  onSelect: (value: number) => void;
  /** 展开状态存放在外部：rdp 重建 MonthCaption 子树时会卸载组件。 */
  state: { open: boolean };
  /**
   * 滚动到列表边界时回调，用于加载更多选项（年份下拉用）。
   * "start" 是滚到顶部，"end" 是滚到底部。
   */
  onEndReached?: (direction: "start" | "end") => void;
}

/**
 * 年 / 月共用的下拉列表。
 *
 * 参考 TDesign select 的下拉面板：**固定高度容器 + 浏览器原生滚动**，
 * 滚动位置完全交给浏览器，任何 JS 回写都会与原生滚动冲突
 * （这正是之前「滚轮怎么滚都卡住」的原因）。
 *
 * 年份支持「滚到边界继续加载」：通过 onEndReached 通知外部扩展窗口，
 * 顶部追加选项后在 layout 阶段补偿 scrollTop，保证视野不跳动。
 * 补偿只在「顶部插入」时发生，且从不干预滚轮事件本身——之前滚不动的
 * 元凶是 Dialog 的滚动锁拦截了 wheel（已通过弹层挂进 DialogContent 解决），
 * 而不是滚动位置管理。
 */
function SelectList({
  label,
  ariaLabel,
  options,
  activeValue,
  onSelect,
  state,
  onEndReached,
}: SelectListProps) {
  // 状态放在外部对象里：组件被 rdp 卸载重建时，展开状态不会丢失。
  const [open, setOpen] = React.useState(() => state.open);
  const setOpenState = (next: boolean) => {
    state.open = next;
    setOpen(next);
  };

  const listRef = React.useRef<HTMLDivElement>(null);
  const triggerRef = React.useRef<HTMLButtonElement>(null);

  // 打开时把选中项滚到中间。只在打开瞬间做一次，之后不再干预滚动。
  React.useEffect(() => {
    if (!open) return;
    const container = listRef.current;
    const target = container?.querySelector<HTMLElement>(`[data-value="${activeValue}"]`);
    if (!container || !target) return;
    container.scrollTop =
      target.offsetTop - container.clientHeight / 2 + target.offsetHeight / 2;
    // 依赖刻意只有 open：之后滚动位置由浏览器维护。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // 顶部追加选项后补偿滚动偏移，保持当前视野不动。
  // 判定「顶部插入」：数量变多且首项变了（月份列表首项恒定，不会误补偿）。
  const prevShapeRef = React.useRef({ first: options[0]?.value, count: options.length });
  React.useLayoutEffect(() => {
    const previous = prevShapeRef.current;
    const added = options.length - previous.count;
    const prepended = added > 0 && options[0]?.value !== previous.first;
    prevShapeRef.current = { first: options[0]?.value, count: options.length };
    if (!prepended) return;
    const container = listRef.current;
    if (container) container.scrollTop += added * LIST_ROW_HEIGHT;
  }, [options]);

  // 滚到边界时通知外部加载更多。
  const loadingRef = React.useRef(false);
  const handleScroll = (event: React.UIEvent<HTMLDivElement>) => {
    if (!onEndReached) return;
    const element = event.currentTarget;
    // 内容不足一屏时不触发，避免刚打开就连续扩展。
    if (element.scrollHeight <= element.clientHeight + 1) return;
    const atStart = element.scrollTop <= 40;
    const atEnd = element.scrollHeight - element.scrollTop - element.clientHeight <= 40;
    if (!atStart && !atEnd) return;
    if (loadingRef.current) return;
    loadingRef.current = true;
    onEndReached(atStart ? "start" : "end");
    // 下一帧解锁：等新选项渲染完成后才允许再次触发。
    requestAnimationFrame(() => {
      loadingRef.current = false;
    });
  };

  // 点击外部时只收起列表，不关闭整个日期面板。
  React.useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (listRef.current?.contains(target)) return;
      if (triggerRef.current?.contains(target)) return;
      setOpenState(false);
    };
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("touchstart", handlePointerDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("touchstart", handlePointerDown);
    };
    // setOpenState 只是同步写外部状态对象，引用无需进入依赖。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpenState(!state.open)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        className="flex h-8 items-center gap-1 rounded-md px-2 text-sm font-medium hover:bg-accent"
      >
        {label}
        <ChevronDown className="h-3.5 w-3.5 opacity-60" />
      </button>

      {open && (
        <div
          ref={listRef}
          role="listbox"
          aria-label={`${ariaLabel}列表`}
          onScroll={handleScroll}
          className="absolute left-0 top-full z-20 mt-1 w-[6.5rem] overflow-y-auto rounded-md border bg-popover py-1 shadow-md"
          style={{ height: LIST_HEIGHT }}
        >
          {options.map((option) => (
            <button
              key={option.value}
              type="button"
              role="option"
              aria-selected={option.value === activeValue}
              aria-disabled={option.disabled || undefined}
              data-value={option.value}
              disabled={option.disabled}
              onClick={() => {
                setOpenState(false);
                onSelect(option.value);
              }}
              className={cn(
                "flex w-full items-center px-2 text-sm disabled:pointer-events-none disabled:opacity-40",
                option.value === activeValue
                  ? "bg-accent font-medium text-accent-foreground"
                  : "hover:bg-accent/60",
              )}
              style={{ height: LIST_ROW_HEIGHT }}
            >
              {option.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * rdp 的年份下拉：初始展示「当前年份 ±50 年」，滚到边界每次再扩 50 年，
 * 直到 {@link YEAR_WINDOW_LIMITS} 的极限（公元前 2000 ~ 公元 9999）。
 */
function YearDropdown({ value, onChange }: DropdownProps) {
  const currentYear =
    typeof value === "number" ? value : Number(value) || new Date().getFullYear();

  // 窗口状态放在模块级：组件被 rdp 重建时不丢失已加载的范围。
  const [window, setWindow] = React.useState(() => {
    if (!yearWindowState.window) {
      yearWindowState.window = yearWindowAround(currentYear);
    }
    return yearWindowState.window;
  });

  // 外部把年份切到窗口之外（如表单填了个很老的日期）时，重新以该年份为中心。
  React.useEffect(() => {
    const current = yearWindowState.window;
    if (!current) return;
    if (currentYear < current.min || currentYear > current.max) {
      const next = yearWindowAround(currentYear);
      yearWindowState.window = next;
      setWindow(next);
    }
  }, [currentYear]);

  const options = React.useMemo(
    () =>
      yearOptionsOf(window).map((year) => ({
        value: year,
        label: `${year}年`,
      })),
    [window],
  );

  const loadMore = React.useCallback((direction: "start" | "end") => {
    setWindow((current) => {
      // 列表降序：顶部是更晚的年份、底部是更早的年份。
      const next = expandYearWindow(current, direction === "start" ? "later" : "earlier");
      if (next === current) return current;
      yearWindowState.window = next;
      return next;
    });
  }, []);

  return (
    <SelectList
      label={`${currentYear}年`}
      ariaLabel="选择年份"
      options={options}
      activeValue={currentYear}
      onEndReached={loadMore}
      onSelect={(year) => {
        // 交给 react-day-picker 的 onChange 处理：它会 setYear 后再 goToMonth。
        onChange?.({ target: { value: String(year) } } as React.ChangeEvent<HTMLSelectElement>);
      }}
      state={yearListOpenState}
    />
  );
}

/** rdp 的月份下拉：与年份下拉同一套样式。 */
function MonthDropdown({ value, onChange }: DropdownProps) {
  const currentMonth = typeof value === "number" ? value : Number(value) || 0;
  const options = React.useMemo(
    () =>
      Array.from({ length: 12 }, (_, index) => ({
        value: index,
        label: `${index + 1}月`,
      })),
    [],
  );

  return (
    <SelectList
      label={`${currentMonth + 1}月`}
      ariaLabel="选择月份"
      options={options}
      activeValue={currentMonth}
      onSelect={(month) => {
        onChange?.({ target: { value: String(month) } } as React.ChangeEvent<HTMLSelectElement>);
      }}
      state={monthListOpenState}
    />
  );
}
