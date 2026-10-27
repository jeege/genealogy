import { cp, mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const out = resolve(root, "dist");
const target = resolve(root, "backend/internal/web/dist");

try {
  await stat(join(out, "index.html"));
} catch {
  console.error("未找到 dist/index.html，请先执行 vite build。");
  process.exit(1);
}

await rm(target, { recursive: true, force: true });
await mkdir(target, { recursive: true });
for (const entry of await readdir(out)) {
  await cp(join(out, entry), join(target, entry), { recursive: true });
}
// 保留占位文件，确保未构建前端时 Go embed 仍可编译。
await writeFile(join(target, ".gitkeep"), "");
console.log(`前端产物已复制到 ${target}`);
