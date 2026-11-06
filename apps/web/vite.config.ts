import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@core": new URL("../../packages/core/src", import.meta.url).pathname,
    },
  },
  server: {
    host: "127.0.0.1",
    port: 5180,
    strictPort: true,
    open: !process.env.TAURI_ENV_PLATFORM,
    proxy: {
      "/api": {
        target: `http://127.0.0.1:${process.env.QSTUDIO_PORT ?? 8799}`,
        changeOrigin: false,
        headers: process.env.QSTUDIO_TOKEN
          ? { Authorization: `Bearer ${process.env.QSTUDIO_TOKEN}` }
          : undefined,
      },
    },
  },
  build: {
    outDir: "dist",
    sourcemap: false,
  },
});
