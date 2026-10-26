export type PublicRuntimeConfig = {
  familySurname: string;
};

type RuntimeEnvironment = Record<string, string | undefined>;

/**
 * 构建时只提供姓氏兜底；运行时真实配置由 Go 的 /api/config 注入，
 * 因此同一个静态产物可以被不同家族部署复用。
 */
export function getPublicRuntimeConfig(env: RuntimeEnvironment = process.env): PublicRuntimeConfig {
  return {
    familySurname: env["FAMILY_SURNAME"]?.trim() || env["NEXT_PUBLIC_FAMILY_SURNAME"]?.trim() || "刘",
  };
}
