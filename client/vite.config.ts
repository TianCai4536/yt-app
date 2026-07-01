import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Web 版部署在 blog 的 /yt-app/ 子路径下；Tauri 桌面版用相对路径
const isTauri = process.env.TAURI_BUILD === "1";

export default defineConfig({
  plugins: [react()],
  base: isTauri ? "./" : "/yt-app/",
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      // 本地 dev 时把 API 代理到 blog
      "/yt-api": {
        target: "http://127.0.0.1:8001",
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/yt-api/, ""),
      },
    },
  },
  build: {
    outDir: "dist",
    sourcemap: false,
  },
});
