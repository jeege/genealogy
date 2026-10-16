export type PublicRuntimeConfig = {
  supabaseUrl: string;
  supabasePublishableKey: string;
  familySurname: string;
};

type RuntimeEnvironment = Record<string, string | undefined>;

function httpUrl(value: string | undefined, name: string): string {
  try {
    const url = new URL(value ?? "");
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
      throw new Error("invalid URL");
    }
    return url.toString().replace(/\/$/, "");
  } catch {
    throw new Error(`${name} 必须是无凭据、查询参数和片段的 HTTP(S) API 地址`);
  }
}

function publicKey(value: string | undefined): string {
  const key = value?.trim() ?? "";
  if (/^sb_publishable_[A-Za-z0-9_-]+$/.test(key)) return key;
  // 兼容旧版 anon JWT；不能将 service_role、用户 token 或 secret key 发往浏览器。
  try {
    const parts = key.split(".");
    if (parts.length === 3) {
      const payload = JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")));
      if (payload.role === "anon") return key;
    }
  } catch {
    // 不在报错中输出配置值，避免误填的 secret 进入日志。
  }
  throw new Error("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY 必须是 publishable key 或旧版 anon JWT，不能使用私密 key");
}

export function getPublicRuntimeConfig(env: RuntimeEnvironment = process.env): PublicRuntimeConfig {
  // 通过环境对象动态读取，避免 Next.js 把 NEXT_PUBLIC_* 固化进构建产物。
  return {
    supabaseUrl: httpUrl(env["NEXT_PUBLIC_SUPABASE_URL"], "NEXT_PUBLIC_SUPABASE_URL"),
    supabasePublishableKey: publicKey(env["NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"]),
    familySurname: env["NEXT_PUBLIC_FAMILY_SURNAME"]?.trim() || "刘",
  };
}

export function getServerSupabaseConfig(env: RuntimeEnvironment = process.env): PublicRuntimeConfig & { internalUrl?: string } {
  return {
    ...getPublicRuntimeConfig(env),
    internalUrl: env["SUPABASE_INTERNAL_URL"]?.trim()
      ? httpUrl(env["SUPABASE_INTERNAL_URL"], "SUPABASE_INTERNAL_URL")
      : undefined,
  };
}

export function getSupabaseCookieName(publicUrl: string): string {
  // 保持 Supabase 默认 cookie 名称，已有浏览器会话可继续使用。
  return `sb-${new URL(publicUrl).hostname.split(".")[0]}-auth-token`;
}

export function serializePublicRuntimeConfig(config: PublicRuntimeConfig): string {
  // application/json 仍受 HTML 的 </script> 解析规则影响，必须转义。
  return JSON.stringify(config).replace(/[<>&\u2028\u2029]/g, (character) =>
    `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
}
