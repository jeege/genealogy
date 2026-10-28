import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = readFileSync(path.join(root, "src/components/date-field.tsx"), "utf8");

/**
 * 年份/月份选择器的回归约束。
 *
 * 这块交互踩过的坑都留下了断言：
 * 1. 滚轮失灵：元凶是 Dialog 的 react-remove-scroll 在 document 捕获阶段
 *    拦截 wheel，弹层 Portal 到 body 会落在放行名单外（见 portal 测试）；
 * 2. 下拉滚一下就关闭：rdp 重建 MonthCaption 子树会卸载组件，
 *    展开状态与已加载范围必须放在模块级；
 * 3. displayIndex 透传 DOM 触发 React 警告。
 */

test("弹层必须挂进 DialogContent,否则滚轮被滚动锁拦截", () => {
  assert.match(
    source,
    /closest\("\[data-slot=dialog-content\]"\)/,
    "应查找最近的 DialogContent 作为 Portal 容器",
  );
  assert.match(source, /container=\{portalContainer\}/, "PopoverContent 应接收解析出的容器");
});

test("展开状态与年份窗口存放在模块级,组件重建不丢失", () => {
  assert.match(source, /const yearListOpenState = \{ open: false \}/, "年份展开状态应在模块级");
  assert.match(source, /const monthListOpenState = \{ open: false \}/, "月份展开状态应在模块级");
  assert.match(source, /const yearWindowState/, "年份窗口应在模块级");
  // SelectList 从外部 state 对象恢复展开状态。
  assert.match(source, /useState\(\(\) => state\.open\)/, "挂载时应从外部状态恢复");
});

test("列表是固定高度的原生滚动容器,不接管 wheel", () => {
  assert.match(source, /overflow-y-auto/, "应为原生滚动容器");
  // 之前用 onWheel + preventDefault 实现加载，把滚轮彻底冻死了。
  assert.doesNotMatch(source, /onWheel=/, "不应挂 wheel 事件处理器");
  assert.doesNotMatch(source, /preventDefault/, "不应阻止默认滚动行为");
});

test("滚动到边界时加载更多年份", () => {
  assert.match(source, /onEndReached/, "SelectList 应有边界回调");
  assert.match(source, /expandYearWindow/, "年份窗口应支持按批扩展");
  // 顶部插入后必须补偿 scrollTop，否则视野会跳；但只允许这一处 +=。
  assert.match(
    source,
    /container\.scrollTop \+= added \* LIST_ROW_HEIGHT/,
    "顶部追加选项后应补偿滚动偏移",
  );
});

test("按年份降序映射扩展方向", () => {
  // 列表降序：顶部是更晚年份（start -> later），底部是更早年份（end -> earlier）。
  assert.match(
    source,
    /direction === "start" \? "later" : "earlier"/,
    "滚到顶部应补更晚的年份",
  );
});

test("displayIndex 不得透传到 DOM", () => {
  assert.match(source, /displayIndex: _displayIndex/, "MonthCaption 应显式解构掉 displayIndex");
});

test("日历自定义组件必须是模块级常量,不能内联定义", () => {
  // 内联箭头函数每次渲染都是新组件类型，React 会卸载重建整棵子树。
  assert.match(
    source,
    /const calendarComponents = \{[\s\S]*?DayButton: LunarDayButton[\s\S]*?MonthCaption: LunarMonthCaption[\s\S]*?YearsDropdown: YearDropdown[\s\S]*?MonthsDropdown: MonthDropdown[\s\S]*?\};/,
    "components 应集中为模块级常量，年月下拉共用一套",
  );
  assert.match(source, /components=\{calendarComponents\}/, "应直接使用该常量");
  assert.doesNotMatch(source, /components=\{\{/, "不应写成内联对象字面量");
});
