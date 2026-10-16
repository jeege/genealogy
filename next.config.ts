import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 每个请求读取部署配置，不缓存不同容器的姓氏、API 地址与 metadata。
  cacheComponents: false,
  output: "standalone",
};

export default nextConfig;
