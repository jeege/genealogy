import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = readFileSync(
  path.join(root, "src/pages/family-tree/member-photo-gallery.tsx"),
  "utf8",
);

/**
 * 照片预览用 PhotoSwipe（photoswipe.com/react-image-gallery）。
 *
 * 关键约束：
 * 1. 必须**动态导入**，否则灯箱 JS/CSS 会打进主包，拖慢成员列表与关系图；
 * 2. 缩略图走 thumbnail_url、灯箱走 url，避免网格加载原图；
 * 3. PhotoSwipe 5 不自带标题，需要自己注册 caption UI。
 */

test("PhotoSwipe 通过动态导入加载,不进入主包", () => {
  assert.match(source, /await import\("photoswipe\/lightbox"\)/, "应动态导入 lightbox");
  assert.match(source, /pswpModule: \(\) => import\("photoswipe"\)/, "核心库也应动态导入");
  // 不允许静态 import 把库拉进主包。
  assert.doesNotMatch(
    source,
    /^import .*from "photoswipe/m,
    "不应静态导入 photoswipe",
  );
  // CSS 例外：官方文档推荐静态引入，且静态才能保证优先级低于我们的覆盖规则。
  assert.match(source, /^import "photoswipe\/style\.css";$/m, "样式应静态引入");
});

test("灯箱用原图、网格用缩略图", () => {
  // 网格 <img> 用缩略图。
  assert.match(source, /src=\{photo\.thumbnail_url\}/, "网格应使用缩略图");
  // 灯箱数据源用原图。
  assert.match(source, /src: photo\.url/, "灯箱应使用原图");
  // 需要真实尺寸，否则 PhotoSwipe 无法正确计算缩放比例。
  assert.match(source, /width: photo\.width \|\| \d+/, "应传入宽度");
  assert.match(source, /height: photo\.height \|\| \d+/, "应传入高度");
});

test("注册自定义标题,因为 PhotoSwipe 5 不自带 caption", () => {
  assert.match(source, /uiRegister/, "应监听 uiRegister 注册 UI");
  assert.match(source, /registerElement\(/, "应注册标题元素");
  assert.match(source, /name: "photo-caption"/, "标题元素名与 globals.css 的类名对应");
  assert.match(source, /caption: photo\.caption/, "数据源应带上 caption 供标题读取");
});

test("实例与状态正确清理", () => {
  // 卸载时销毁实例，避免残留 DOM 与事件监听。
  assert.match(source, /lightboxRef\.current\?\.destroy\?\.\(\)/, "卸载时应销毁实例");
  // 重复点击不应重复 import 或新建实例。
  assert.match(source, /loadingRef\.current/, "应有加载中的去重标记");
});

test("缩放配置覆盖桌面滚轮与移动端双指", () => {
  // 之前缩放异常的根因：PhotoSwipe 默认 tapAction 是 close，
  // 移动端一触碰就关闭，双指缩放根本来不及生效。
  assert.match(source, /wheelToZoom: true/, "桌面应支持滚轮缩放");
  assert.match(source, /secondaryZoomLevel: 2/, "双击/双指放大目标倍数");
  assert.match(source, /maxZoomLevel: 4/, "放大上限");
  assert.match(source, /allowPanToNext: true/, "放大后仍可切换照片");

  // 手势与原生的冲突点：这三项必须显式关闭/改写。
  assert.match(source, /pinchToClose: false/, "捏合关闭会与捏合缩小冲突");
  assert.match(source, /closeOnVerticalDrag: false/, "竖向拖动不应关闭灯箱");
  assert.match(source, /tapAction: "zoom"/, "单击应缩放而不是关闭");
  assert.match(source, /bgClickAction: "close"/, "只有点背景才关闭");
});

test("打开时只锁滚动溢出,不碰 touch-action", () => {
  // 关键教训：在 html/body 上设 touch-action: none 会作用于整个后代树，
  // 使灯箱内的双指捏合被浏览器直接忽略——表现为「缩放整页、照片不动」。
  // PhotoSwipe 自己的 .pswp 已有 touch-action: none，够用。
  assert.match(source, /function lockPageGestures/, "应有打开时的页面准备");
  assert.match(source, /element\.style\.overflow = "hidden"/, "应锁定背景滚动");
  assert.doesNotMatch(
    source,
    /element\.style\.touchAction\s*=\s*"none"/,
    "不得在 html/body 上设 touch-action: none",
  );
  // 必须精确还原 overflow，否则关闭后页面无法滚动。
  assert.match(source, /dataset\.pswpOverflow/, "应保存并还原原值");
  // close 回调现在是多行（还要 detach Esc 守卫），断言只检查调用了还原逻辑。
  const closeBlock = source.slice(source.indexOf('lightbox.on("close"'));
  assert.ok(
    closeBlock.slice(0, 200).includes("unlockPageGestures"),
    "关闭时应还原 overflow",
  );
});

test("不再为触摸事件添加无效的传播拦截", () => {
  // Radix Dialog 的 RemoveScroll 带 allowPinchZoom: true，
  // touches.length === 2 时直接放行，并不会拦双指手势，
  // 因此不需要（也不该有）touch 层面的 stopImmediatePropagation 守卫。
  // 注意：Esc 守卫另有一套逻辑，见下面的用例。
  assert.doesNotMatch(source, /wheelGuard/, "不应保留无效的触摸守卫");
  const touchGuard = /addEventListener\(\s*"touch(start|move)"/;
  assert.doesNotMatch(source, touchGuard, "不应注册 touch 拦截监听");
});

test("焦点交接:灯箱接管时让外层 Dialog 退出焦点管理", () => {
  // 详情弹窗是 Radix Dialog（FocusScope 把焦点锁在内部），而 PhotoSwipe 也有
  // 自己的焦点陷阱（_onFocusIn 把焦点拉回灯箱）。两者互抢 → 递归 →
  // "Maximum call stack size exceeded"，表现为点放大镜后预览立刻退出。
  // 解法：灯箱初始化完成后给 Dialog 加 inert，焦点完全交给灯箱。
  assert.match(source, /setContainerInert/, "应有焦点交接逻辑");
  assert.match(source, /dialog\.setAttribute\("inert", ""\)/, "应设置 inert 阻止焦点与事件");
  // 不要再加 aria-hidden：焦点留在 Dialog 内时浏览器会打印
  // "Blocked aria-hidden on an element because its descendant retained focus"。
  // inert 已同时阻止聚焦与事件，够用且更干净。
  assert.doesNotMatch(
    source,
    /setAttribute\("aria-hidden"/,
    "不应再设置 aria-hidden（会触发浏览器警告）",
  );
  // 顺序很关键：必须在 afterInit（焦点已移入灯箱）之后再加 inert，
  // 否则按钮点不动、灯箱起不来。
  const afterInitIdx = source.indexOf('lightbox.on("afterInit"');
  const inertCallIdx = source.indexOf("setContainerInert(true)", afterInitIdx);
  assert.ok(afterInitIdx > 0 && inertCallIdx > afterInitIdx, "inert 必须在 afterInit 之后设置");
});

test("关闭灯箱不得触发焦点递归", () => {
  // 栈溢出根因：unlock 时手动 trigger.focus() 与 PhotoSwipe 的焦点陷阱
  // （trapFocus/returnFocus 默认 true）互相触发，形成无限递归。
  assert.match(source, /trapFocus: false/, "应关闭 PhotoSwipe 自带焦点陷阱");
  assert.match(source, /returnFocus: false/, "应关闭自动归还焦点");
  // 解锁路径里不允许再手动 focus。
  const unlock = source.slice(
    source.indexOf("function unlockPageGestures"),
    source.indexOf("function unlockPageGestures") + 1200,
  );
  assert.doesNotMatch(unlock, /\.focus\(/, "解锁时不应手动调用 focus");
});

test("详情弹窗拦截外部交互,避免点照片时整个预览被关掉", () => {
  // PhotoSwipe 渲染在 Dialog 之外，点击它会被 Radix 判定为「与外部交互」，
  // 从而关闭详情弹窗——表现为点放大镜后预览直接退出。
  const dialog = readFileSync(
    path.join(root, "src/pages/family-tree/member-detail-dialog.tsx"),
    "utf8",
  );
  assert.match(
    dialog,
    /onInteractOutside=\{\(event\) => event\.preventDefault\(\)\}/,
    "详情弹窗应拦截外部交互",
  );
});

test("卸载与异常路径不会泄漏手势锁", () => {
  // 路由切换导致组件直接卸载时，可能收不到 close 事件。
  assert.match(source, /unlockPageGestures\(\);/,
    "组件卸载时应兜底解锁");
  const cleanup = source.slice(source.indexOf("lightboxRef.current?.destroy"));
  assert.ok(cleanup.includes("unlockPageGestures"), "卸载清理应包含解锁");
});

test("灯箱必须覆盖 body 的 pointer-events: none", () => {
  // 真正的根因：Radix Dialog（modal）会给 <body> 设 pointer-events: none，
  // 而 PhotoSwipe 把自己的根节点直接 append 到 body 上，于是继承了 none，
  // 收不到任何指针/触摸事件 —— 双指捏合被浏览器当成页面缩放。
  const css = readFileSync(path.join(root, "src/globals.css"), "utf8");
  assert.match(
    css,
    /\.pswp \{[^}]*pointer-events: auto/s,
    "灯箱根节点必须显式恢复 pointer-events",
  );
});

test("样式静态引入,保证覆盖顺序", () => {
  // 官方文档推荐静态 import 'photoswipe/style.css'。
  // 若改成动态 import，注入时机不确定，可能覆盖掉 globals.css 的修正。
  assert.match(source, /^import "photoswipe\/style\.css";$/m, "应静态引入 PhotoSwipe 样式");
  assert.doesNotMatch(source, /await import\("photoswipe\/dist\/photoswipe\.css"\)/, "不应动态引入样式");
});

test("灯箱容器接管触摸手势", () => {
  // CSS 层隔离，避免被页面滚动/浏览器手势抢走（iOS Safari 尤其明显）。
  const css = readFileSync(path.join(root, "src/globals.css"), "utf8");
  assert.match(css, /\.pswp \{[^}]*touch-action: none/s, "灯箱应禁用浏览器默认触摸行为");
  assert.match(css, /overscroll-behavior: contain/, "应阻止滚动链传导");
});

test("缩略图为 1:1 正方形", () => {
  // 照片原图比例各异，统一裁成正方形网格才整齐。
  assert.match(source, /aspect-square/, "缩略图应使用 1:1 比例");
  assert.doesNotMatch(source, /aspect-\[4\/3\]/, "不应残留旧的 4:3 比例");
  // 必须配合 object-cover 裁切，否则比例会被拉伸变形。
  assert.match(source, /aspect-square[^"]*object-cover/, "应配合 object-cover 保证不变形");
});

test("Esc 逐层关闭:先关灯箱,再关详情弹窗", () => {
  // 早先试图在 document 捕获阶段抢注册监听来拦 Radix，但 Radix 的监听
  // 在 Dialog 挂载时就已注册，顺序上永远抢不到，因此方案不可靠。
  //
  // 正确做法：Radix 的 useEscapeKeydown 会先调用 onEscapeKeyDown、
  // 再检查 event.defaultPrevented。详情弹窗只要在灯箱打开时 preventDefault，
  // 就只关灯箱，不依赖任何监听顺序。
  const dialog = readFileSync(
    path.join(root, "src/pages/family-tree/member-detail-dialog.tsx"),
    "utf8",
  );
  assert.match(dialog, /onEscapeKeyDown=/, "详情弹窗应处理 Esc");
  assert.match(dialog, /isPhotoLightboxOpen\(\)/, "应判断灯箱是否打开");
  assert.match(
    dialog,
    /onEscapeKeyDown=\{[\s\S]{0,300}?event\.preventDefault\(\)/,
    "灯箱打开时应阻止弹窗关闭",
  );

  // 不再依赖全局捕获监听。
  assert.doesNotMatch(source, /escapeGuard/, "不应保留基于监听顺序的守卫");
  // 但仍需暴露查询函数供弹窗判断。
  assert.match(source, /export function isPhotoLightboxOpen/, "应导出灯箱状态查询");
});

test("空状态有独立占位", () => {
  assert.match(source, /export function MemberPhotoEmpty/, "应导出空状态组件");
});
