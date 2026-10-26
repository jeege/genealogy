import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/**
 * 解析简化版 dotenv（KEY=VALUE、注释、单双引号）。
 * 不展开变量，也不执行任何脚本内容。
 */
export function parseEnv(content) {
  const values = {};
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const position = trimmed.indexOf("=");
    if (position < 1) continue;
    const key = trimmed.slice(0, position).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    let value = trimmed.slice(position + 1).trim();
    if (value.startsWith('"') && value.endsWith('"')) {
      try { value = JSON.parse(value); } catch { continue; }
    } else if (value.startsWith("'") && value.endsWith("'")) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}

/** 先加载 .env，再加载 .env.local；已存在的进程环境变量优先。 */
export async function loadEnvFiles(root, env = process.env) {
  // 进程环境变量优先级最高；文件之间仍允许后者覆盖前者。
  const fromProcess = new Set(Object.keys(env));
  for (const name of [".env", ".env.local"]) {
    let content;
    try {
      content = await readFile(resolve(root, name), "utf8");
    } catch {
      continue;
    }
    for (const [key, value] of Object.entries(parseEnv(content))) {
      if (!fromProcess.has(key)) env[key] = value;
    }
  }
  return env;
}

async function main() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const env = await loadEnvFiles(root);
  const args = process.argv.slice(2);
  const command = args.length > 0 ? args : ["serve"];

  const child = spawn(process.execPath, [
    resolve(root, "scripts", "go.mjs"), "run", "./cmd/server", ...command,
  ], { stdio: "inherit", env });
  for (const signal of ["SIGTERM", "SIGINT"]) {
    process.on(signal, () => child.kill(signal));
  }
  child.on("error", (error) => {
    console.error(`无法启动 Go：${error.message}`);
    process.exit(1);
  });
  child.on("exit", (code, signal) => {
    if (signal) process.exit(signal === "SIGINT" ? 130 : 143);
    process.exit(code ?? 1);
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
