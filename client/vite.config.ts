import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Web 版部署在 blog 的 /yt-app/ 子路径下
export default defineConfig({
  plugins: [react()],
  base: "/yt-app/",
  server: {
    port: 5173,
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
