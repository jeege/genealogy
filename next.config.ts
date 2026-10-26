import path from "node:path";
import type { NextConfig } from "next";

// 仅开发时把 /api 代理到本机 Go 服务；生产静态站点与 API 同源，
// 因此生产配置里完全不出现 rewrites，避免静态导出警告。
const devProxy: Partial<NextConfig> = process.env.NODE_ENV === "development"
  ? {
      async rewrites() {
        const target = (process.env.DEV_API_PROXY_TARGET?.trim() || "http://127.0.0.1:8080").replace(/\/$/, "");
        return [{ source: "/api/:path*", destination: `${target}/api/:path*` }];
      },
    }
  : {};

const nextConfig: NextConfig = {
  // 前端完全静态导出，由 Go 二进制内嵌并托管。
  output: process.env.NODE_ENV === "production" ? "export" : undefined,
  // 生产静态站点使用目录索引；开发模式关闭以避免 /api 被 308 到带斜杠地址。
  trailingSlash: process.env.NODE_ENV === "production",
  images: { unoptimized: true },
  // 显式限定 Turbopack 根目录，避免扫描上级目录中的无关 lockfile。
  turbopack: { root: path.resolve(".") },
  ...devProxy,
};

export default nextConfig;
