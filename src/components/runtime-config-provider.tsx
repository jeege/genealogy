import { createContext, useContext, useEffect, useState } from "react";
import type { PublicRuntimeConfig } from "@/lib/runtime-config";

const DEFAULT_CONFIG: PublicRuntimeConfig = { familySurname: "刘" };
const RuntimeConfigContext = createContext<PublicRuntimeConfig>(DEFAULT_CONFIG);

export function RuntimeConfigProvider({
  initialConfig = DEFAULT_CONFIG,
  children,
}: {
  initialConfig?: PublicRuntimeConfig;
  children: React.ReactNode;
}) {
  const [config, setConfig] = useState<PublicRuntimeConfig>(initialConfig);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/config", { cache: "no-store", credentials: "same-origin" })
      .then((response) => response.ok ? response.json() : null)
      .then((data: unknown) => {
        if (cancelled || !data || typeof data !== "object") return;
        const surname = (data as { familySurname?: unknown }).familySurname;
        if (typeof surname !== "string" || !surname.trim()) return;
        const next = { familySurname: surname.trim() };
        setConfig(next);
        document.title = `${next.familySurname}氏族谱管理系统`;
      })
      .catch(() => {
        // 配置接口不可用时保留构建时默认姓氏。
      });
    return () => { cancelled = true; };
  }, []);

  return <RuntimeConfigContext.Provider value={config}>{children}</RuntimeConfigContext.Provider>;
}

export function useRuntimeConfig(): PublicRuntimeConfig {
  return useContext(RuntimeConfigContext);
}
