import * as React from "react";
import { ImageOff } from "lucide-react";
import { cn } from "@/lib/utils";
import type { MemberPhoto } from "@/lib/api/types";
// 按 PhotoSwipe 官方文档静态引入样式（npm 用法：import 'photoswipe/style.css'）。
// 静态引入同时保证它的优先级低于 globals.css 中我们对 .pswp 的覆盖规则。
import "photoswipe/style.css";

interface MemberPhotoGalleryProps {
  photos: MemberPhoto[];
  /** 成员姓名，用于图片的替代文本。 */
  memberName: string;
  className?: string;
}

/**
 * 成员照片展示：缩略图网格 + PhotoSwipe 灯箱预览。
 *
 * 灯箱用 PhotoSwipe（photoswipe.com）而非自研 Dialog：它自带手势缩放、
 * 双指捏合、滑动切换、键盘导航与焦点管理，移动端体验明显更好。
 *
 * PhotoSwipe 走**动态导入**：JS 与样式只在用户首次点开大图时才加载，
 * 不增加成员列表/关系图的初始包体。
 */
export function MemberPhotoGallery({ photos, memberName, className }: MemberPhotoGalleryProps) {
  // 已在加载或已就绪的 lightbox 实例；用 ref 避免重复 import。
  const lightboxRef = React.useRef<PhotoSwipeLike | null>(null);
  const loadingRef = React.useRef<Promise<PhotoSwipeLike | null> | null>(null);

  /** 确保 PhotoSwipe 已加载并完成 init()。 */
  const ensureLightbox = React.useCallback(async (): Promise<PhotoSwipeLike | null> => {
    if (lightboxRef.current) return lightboxRef.current;
    if (loadingRef.current) return loadingRef.current;

    loadingRef.current = (async () => {
      try {
        // 只动态导入 JS：样式已经在模块顶部静态引入（见官方文档的做法）。
        const { default: PhotoSwipeLightbox } = await import("photoswipe/lightbox");
        const lightbox = new PhotoSwipeLightbox({
          // 不绑定 DOM 结构：图片数据在 open() 时直接传入。
          pswpModule: () => import("photoswipe"),
          // 深色背景，与族谱详情页的仿古纸张风格对比更清晰。
          bgOpacity: 0.92,
          showHideAnimationType: "zoom",

          // ---- 缩放（桌面滚轮 + 移动端双指） ----
          // 允许鼠标滚轮缩放。
          wheelToZoom: true,
          // 初始按「适应屏幕」展示整张照片。
          initialZoomLevel: "fit",
          // 双击/双指放大到 2 倍；这是移动端主要的手势缩放目标。
          secondaryZoomLevel: 2,
          // 上限给到 4 倍，老照片看清细节需要更多余量。
          maxZoomLevel: 4,
          // 放大后仍允许左右切换，符合浏览多张照片的预期。
          allowPanToNext: true,
          // 关闭「捏合关闭」：容易与「捏合缩小」冲突，
          // 用户在缩小查看时会误触关闭整个灯箱。
          pinchToClose: false,
          // 拖动到边缘时回弹，而不是直接关闭。
          closeOnVerticalDrag: false,
          // 点击图片在 1x / 2x 间切换，避免单击直接关闭。
          imageClickAction: "zoom",
          tapAction: "zoom",
          doubleTapAction: "zoom",
          // 背景点击才关闭，避免误触。
          bgClickAction: "close",

          // 把灯箱挂到 body 下（默认）会继承 Radix Dialog 给 body 设的
          // `pointer-events: none`，导致灯箱收不到触摸/指针事件，
          // 双指捏合被浏览器当成页面缩放。globals.css 里已用
          // `.pswp { pointer-events: auto }` 覆盖，这里保持默认挂载位置。

          // ---- 焦点管理 ----
          // 关闭 PhotoSwipe 自带的焦点陷阱：它会把焦点拉回灯箱，
          // 与外层 Radix Dialog 的 FocusScope 互相抢焦点形成递归。
          // 由我们通过 inert 交接焦点即可。
          trapFocus: false,
          // 也不让它自动归还：inert 移除后由 Radix 恢复焦点。
          returnFocus: false,
        });
        // PhotoSwipe 5 默认不渲染标题，按官方 caption 文档注册自定义 UI：
        // 在 uiRegister 里加一个非按钮元素，change 时用当前 slide 的 caption 填充。
        lightbox.on("uiRegister", () => {
          const pswp = lightbox.pswp;
          if (!pswp?.ui) return;
          pswp.ui.registerElement({
            name: "photo-caption",
            order: 9,
            isButton: false,
            appendTo: "root",
            onInit: (element) => {
              const update = () => {
                const caption = (pswp.currSlide?.data?.caption as string | undefined) ?? "";
                element.textContent = caption;
                element.classList.toggle("pswp__caption--empty", !caption);
              };
              pswp.on("change", update);
              update();
            },
          });
        });
        // 打开前记录触发元素并锁定背景滚动。
        // 注意：Dialog 的 inert 必须等灯箱完成初始化（焦点已移入灯箱）之后再设置，
        // 否则按钮点不动、灯箱也起不来——见下面的 afterInit。
        lightbox.on("beforeOpen", () => {
          rememberTrigger();
          lockPageGestures();
        });
        lightbox.on("afterInit", () => {
          // 灯箱接管焦点后，让外层 Dialog 退出焦点管理，避免两个焦点陷阱互相递归。
          setContainerInert(true);
        });
        lightbox.on("close", () => unlockPageGestures());
        lightbox.on("destroy", () => unlockPageGestures());

        lightbox.init();
        lightboxRef.current = lightbox as unknown as PhotoSwipeLike;
        return lightboxRef.current;
      } catch {
        return null;
      }
    })();

    return loadingRef.current;
  }, []);

  // 组件卸载时销毁实例，避免残留的 DOM 与事件监听。
  React.useEffect(
    () => () => {
      lightboxRef.current?.destroy?.();
      lightboxRef.current = null;
      // 组件卸载（含路由切换）时确保手势锁被释放。
      unlockPageGestures();
    },
    [],
  );

  /** 打开第 index 张；PhotoSwipe 会负责后续的切换与缩放。 */
  const openAt = async (index: number) => {
    const lightbox = await ensureLightbox();
    if (!lightbox) return;
    const dataSource = photos.map((photo) => ({
      src: photo.url,
      width: photo.width || 1600,
      height: photo.height || 1200,
      alt: photo.caption ?? `${memberName}的照片`,
      // 供上面注册的 caption 元素读取（PhotoSwipe 会原样保留 data 里的自定义字段）。
      caption: photo.caption ?? "",
    }));
    lightbox.loadAndOpen(index, dataSource);
  };

  if (photos.length === 0) return null;

  return (
    <ul className={cn("grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4", className)}>
      {photos.map((photo, index) => (
        <li key={photo.id}>
          <button
            type="button"
            onClick={() => void openAt(index)}
            className="group relative block w-full cursor-zoom-in overflow-hidden rounded-md border bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label={photo.caption ? `查看照片：${photo.caption}` : "查看照片"}
          >
            <img
              src={photo.thumbnail_url}
              alt={photo.caption ?? `${memberName}的照片`}
              width={photo.width || undefined}
              height={photo.height || undefined}
              loading="lazy"
              // 统一 1:1 正方形缩略图，网格排列最整齐；原图比例各异也不影响。
              className="aspect-square w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
            />
            {photo.caption && (
              <span className="absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/60 to-transparent px-2 py-1 text-left text-[11px] text-white">
                {photo.caption}
              </span>
            )}
          </button>
        </li>
      ))}
    </ul>
  );
}

/**
 * 灯箱打开时的页面准备。
 *
 * 只做两件**必要且互不干扰**的事：
 *
 * 1. 给外层 Radix Dialog 加 `inert`，让它退出焦点管理
 *    （否则与 PhotoSwipe 的焦点逻辑互相递归，见 setContainerInert）。
 *
 * 2. 记录/锁定页面滚动溢出。**不要**在这里给 html/body 设 `touch-action: none`：
 *    `touch-action` 会作用于整个后代树，使灯箱内的双指捏合被浏览器直接忽略，
 *    PhotoSwipe 收不到合成后的 pointer 事件 —— 这正是「双指缩放整页、
 *    照片不动」的原因。PhotoSwipe 自己的 `.pswp` 已有 `touch-action: none`，
 *    足够约束灯箱内部。
 */
function lockPageGestures() {
  if (typeof document === "undefined") return;
  const { documentElement: html, body } = document;
  const targets = [html, body].filter(Boolean) as HTMLElement[];

  for (const element of targets) {
    // 只锁滚动溢出，不碰 touch-action。
    if (!element.dataset.pswpOverflow) {
      element.dataset.pswpOverflow = element.style.overflow || " ";
    }
    element.style.overflow = "hidden";
  }
}

/**
 * 灯箱是否处于打开状态。
 *
 * 详情弹窗需要在 onEscapeKeyDown 里判断：灯箱开着时 Esc 应该只关灯箱。
 * 直接查 DOM（.pswp--open）最可靠，避免额外的状态同步。
 */
export function isPhotoLightboxOpen(): boolean {
  if (typeof document === "undefined") return false;
  return document.querySelector(".pswp--open") !== null;
}

/** 关闭当前打开的灯箱（供 Esc 场景复用）。 */
export function closePhotoLightbox(): void {
  if (typeof document === "undefined") return;
  const scope = globalThis as unknown as {
    window?: { pswp?: { close?: () => void } };
    pswp?: { close?: () => void };
  };
  (scope.window?.pswp ?? scope.pswp)?.close?.();
}

/** 记录触发「放大」的元素，供灯箱关闭后归还焦点。 */
const focusHandoff = { trigger: null as HTMLElement | null };

/**
 * 灯箱接管期间让外层 Radix Dialog 退出焦点管理。
 *
 * 详情弹窗是 Radix Dialog，其 FocusScope 会把焦点锁在弹窗内；PhotoSwipe 打开后
 * 也要争用焦点。两者互抢会形成递归（`Maximum call stack size exceeded`）。
 * 给 Dialog 容器加 `inert` 后，其内部既不可聚焦也不响应事件，焦点完全交给灯箱。
 *
 * 用 `closest` 从触发元素向上找，多弹窗叠加时不会认错目标。
 * 不要同时设 aria-hidden：焦点尚在其内部时浏览器会打印
 * "Blocked aria-hidden on an element because its descendant retained focus"。
 */
function setContainerInert(inert: boolean) {
  if (typeof document === "undefined") return;
  const trigger = focusHandoff.trigger;
  const dialog =
    trigger?.closest<HTMLElement>("[data-slot=dialog-content]") ??
    document.querySelector<HTMLElement>("[data-slot=dialog-content]");
  if (!dialog) return;

  if (inert) {
    dialog.setAttribute("inert", "");
  } else {
    dialog.removeAttribute("inert");
    focusHandoff.trigger = null;
  }
}

/** 打开灯箱前记录触发元素。 */
function rememberTrigger() {
  if (typeof document === "undefined") return;
  focusHandoff.trigger = document.activeElement as HTMLElement | null;
}

/** 还原 lockPageGestures 的改动。 */
function unlockPageGestures() {
  if (typeof document === "undefined") return;
  setContainerInert(false);
  const { documentElement: html, body } = document;
  const targets = [html, body].filter(Boolean) as HTMLElement[];

  for (const element of targets) {
    const original = element.dataset.pswpOverflow;
    if (original === undefined) continue;
    element.style.overflow = original.trim() === "" ? "" : original;
    delete element.dataset.pswpOverflow;
  }
}

/** 照片区为空时的占位。 */
export function MemberPhotoEmpty({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-1 rounded-md border border-dashed py-6 text-muted-foreground",
        className,
      )}
    >
      <ImageOff className="h-5 w-5 opacity-40" />
      <span className="text-xs">暂无照片</span>
    </div>
  );
}

/**
 * PhotoSwipe 实例的最小结构。
 *
 * 官方类型通过泛型推导，动态导入后逐个标注反而更啰嗦；
 * 这里只声明实际用到的两个方法，避免把 any 扩散到组件其它部分。
 */
interface PhotoSwipeLike {
  init(): void;
  loadAndOpen(index: number, dataSource: unknown): boolean;
  destroy?(): void;
}
