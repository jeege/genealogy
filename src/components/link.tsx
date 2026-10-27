import { forwardRef } from "react";
import { Link as RouterLink, type LinkProps } from "react-router-dom";
import { cn } from "@/lib/utils";

/**
 * 兼容 shadcn 的 `<Link href>` 写法，内部使用 React Router 的 `to`。
 * 这样 UI 组件与页面不必区分两套链接 API。
 */
export type AppLinkProps = Omit<LinkProps, "to"> & {
  href: string;
  className?: string;
};

export const Link = forwardRef<HTMLAnchorElement, AppLinkProps>(function AppLink(
  { href, className, ...props },
  ref,
) {
  return <RouterLink ref={ref} to={href} className={cn(className)} {...props} />;
});
