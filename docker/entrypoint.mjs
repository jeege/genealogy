import { spawn } from "node:child_process";
import runtimeConfig from "./runtime-config.cjs";

try {
  runtimeConfig.getServerSupabaseConfig();
} catch (error) {
  console.error(`应用配置无效：${error.message}`);
  process.exit(1);
}

const server = spawn(process.execPath, ["server.js"], { stdio: "inherit", env: process.env });
for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => server.kill(signal));
}
server.on("error", () => {
  console.error("应用进程启动失败");
  process.exit(1);
});
server.on("exit", (code, signal) => {
  if (signal) {
    process.exit(signal === "SIGINT" ? 130 : 143);
  } else {
    process.exit(code ?? 1);
  }
});
