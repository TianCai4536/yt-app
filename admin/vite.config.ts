import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  base: "/ai-app_admin/",
  server: {
    port: 5174,
    proxy: {
      "/yt-api": {
        target: "http://127.0.0.1:8001",
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/yt-api/, ""),
      },
    },
  },
  build: { outDir: "dist", sourcemap: false },
});
