import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dateField = readFileSync(path.join(root, "src/components/date-field.tsx"), "utf8");
const popover = readFileSync(path.join(root, "src/components/ui/popover.tsx"), "utf8");

/**
 * 回归:日期弹层位于「编辑成员」Dialog 内时,年份列表无法用滚轮滚动。
 *
 * 根因：Radix Dialog 用 react-remove-scroll 在 document 捕获阶段拦截 wheel,
 * 只放行 DialogContent 内部的滚动。Popover 默认 Portal 到 document.body,
 * 落在白名单之外,于是 wheel 被吞掉（用鼠标拖滚动条却能滚）。
 *
 * 修复：把弹层的 Portal 容器设为最近的 DialogContent。
 */

test("PopoverContent 支持自定义 Portal 容器", () => {
  assert.match(popover, /container\?:/, "PopoverContent 应接收 container 属性");
  assert.match(
    popover,
    /<PopoverPrimitive\.Portal container=\{container\}>/,
    "应把 container 透传给 Portal",
  );
});

test("DateField 在 Dialog 内时把弹层挂到 DialogContent 上", () => {
  // 用 closest 向上查找最近的 dialog-content，作为 Portal 容器。
  assert.match(
    dateField,
    /closest\("\[data-slot=dialog-content\]"\)/,
    "应查找最近的 DialogContent",
  );
  assert.match(
    dateField,
    /container=\{portalContainer\}/,
    "应把解析出的容器传给 PopoverContent",
  );
});
