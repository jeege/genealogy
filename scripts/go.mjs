import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * 统一的 Go 命令入口：把构建缓存放进仓库内的 .cache，避免污染用户全局
 * GOPATH / 构建缓存，也让受限环境（CI、沙箱）无需额外设置即可编译。
 */
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cacheRoot = process.env.GENEALOGY_GO_CACHE?.trim() || resolve(root, ".cache");
const env = {
  ...process.env,
  GOCACHE: process.env.GOCACHE || resolve(cacheRoot, "go-build"),
  GOMODCACHE: process.env.GOMODCACHE || resolve(cacheRoot, "go-mod"),
};

for (const directory of [env.GOCACHE, env.GOMODCACHE]) {
  try {
    mkdirSync(directory, { recursive: true });
  } catch {
    // 只读环境下退回到 Go 自己的默认缓存。
  }
}

if (!process.env.GOFLAGS) env.GOFLAGS = "-mod=mod";

const child = spawn("go", process.argv.slice(2), {
  cwd: resolve(root, "backend"),
  stdio: "inherit",
  env,
});
child.on("error", (error) => {
  console.error(`无法执行 go：${error.message}`);
  process.exit(1);
});
child.on("exit", (code, signal) => {
  if (signal) process.exit(signal === "SIGINT" ? 130 : 143);
  process.exit(code ?? 1);
});
