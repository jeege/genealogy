import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const apiProxyTarget = (process.env.DEV_API_PROXY_TARGET ?? "http://127.0.0.1:8080").replace(/\/$/, "");

export default defineConfig({
  plugins: [react()],
  // 部分依赖（@xyflow/react、tiny-invariant）在浏览器分支里读取 process.env，
  // 用 define 提供空对象，避免运行时报 "process is not defined"。
  define: {
    "process.env.NODE_ENV": JSON.stringify(process.env.NODE_ENV ?? "production"),
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
  server: {
    port: 3000,
    // 开发时把 /api 转发到 Go，生产由 Go 同源托管静态资源与接口。
    proxy: {
      "/api": { target: apiProxyTarget, changeOrigin: false },
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: false,
    chunkSizeWarningLimit: 1600,
    rollupOptions: {
      output: {
        // 把体积大且变化少的依赖拆开，便于浏览器缓存。
        manualChunks: {
          react: ["react", "react-dom", "react-router-dom"],
          graph: ["@xyflow/react", "@dagrejs/dagre"],
          charts: ["recharts"],
          editor: ["slate", "slate-react", "slate-history"],
          spreadsheet: ["xlsx"],
        },
      },
    },
  },
});
