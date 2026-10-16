"use client";

import { createContext, useContext } from "react";
import type { PublicRuntimeConfig } from "@/lib/runtime-config";

const RuntimeConfigContext = createContext<PublicRuntimeConfig | null>(null);

export function RuntimeConfigProvider({ config, children }: {
  config: PublicRuntimeConfig;
  children: React.ReactNode;
}) {
  return <RuntimeConfigContext.Provider value={config}>{children}</RuntimeConfigContext.Provider>;
}

export function useRuntimeConfig(): PublicRuntimeConfig {
  const config = useContext(RuntimeConfigContext);
  if (!config) throw new Error("缺少 RuntimeConfigProvider");
  return config;
}

// 供登录、退出等事件回调同步创建 Supabase 客户端；不把请求配置放进服务端模块全局变量。
export function getBrowserPublicRuntimeConfig(): PublicRuntimeConfig {
  const element = document.getElementById("public-runtime-config");
  if (!element?.textContent) throw new Error("缺少浏览器运行时配置");
  return JSON.parse(element.textContent) as PublicRuntimeConfig;
}
