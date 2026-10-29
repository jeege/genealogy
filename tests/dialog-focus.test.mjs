import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const table = readFileSync(
  path.join(root, "src/pages/family-tree/family-members-table.tsx"),
  "utf8",
);

/**
 * 回归：打开「编辑成员」弹窗时，控制台报
 * "Blocked aria-hidden on an element because its descendant retained focus"。
 *
 * 根因：onOpenAutoFocus 里只调了 preventDefault()，焦点因此留在触发按钮上，
 * 而该按钮位于 #root 内；Radix 随后给 #root 设 aria-hidden，
 * 浏览器不允许隐藏「仍持有焦点」的元素。
 *
 * 正确做法：阻止默认的「聚焦第一个可聚焦元素」后，
 * 仍要主动把焦点移入弹窗容器。
 */

test("阻止自动聚焦后必须主动把焦点移入弹窗", () => {
  assert.match(table, /onOpenAutoFocus=/, "应处理自动聚焦");
  // 关键：preventDefault 之后必须有一次 focus() 调用。
  const block = table.slice(
    table.indexOf("onOpenAutoFocus="),
    table.indexOf("onOpenAutoFocus=") + 900,
  );
  assert.match(block, /preventDefault\(\)/, "应阻止默认聚焦行为");
  assert.match(block, /\.focus\(/, "必须主动聚焦弹窗容器");
  // 兜底：容器不可聚焦时退回第一个可聚焦子元素。
  assert.match(block, /querySelector<HTMLElement>/, "应有兜底：聚焦第一个可聚焦子元素");
});

test("不应只阻止聚焦而不管焦点去向", () => {
  // 旧写法：onOpenAutoFocus={(e) => e.preventDefault()}  —— 只有 prevent 没有 focus
  assert.doesNotMatch(
    table,
    /onOpenAutoFocus=\{\(e\)\s*=>\s*e\.preventDefault\(\)\}/,
    "不能只阻止聚焦而让焦点留在外部",
  );
});
