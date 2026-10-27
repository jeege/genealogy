export type PublicRuntimeConfig = {
  familySurname: string;
};

/**
 * 纯前端构建时只提供姓氏兜底；运行时真实配置由 Go 的 /api/config 注入，
 * 因此同一个静态产物可以被不同家族部署复用。
 */
export function getPublicRuntimeConfig(
  env: Record<string, string | undefined> = {},
): PublicRuntimeConfig {
  return {
    familySurname: env["VITE_FAMILY_SURNAME"]?.trim() || env["FAMILY_SURNAME"]?.trim() || "刘",
  };
}
