import { cp, mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const out = resolve(root, "out");
const dist = resolve(root, "backend/internal/web/dist");

try {
  await stat(join(out, "index.html"));
} catch {
  console.error("未找到 out/index.html，请先确认 next build 使用 output: export。");
  process.exit(1);
}

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });
for (const entry of await readdir(out)) {
  await cp(join(out, entry), join(dist, entry), { recursive: true });
}
// 保留占位文件，确保未构建前端时 Go embed 仍可编译。
await writeFile(join(dist, ".gitkeep"), "");
console.log(`静态页面已复制到 ${dist}`);
