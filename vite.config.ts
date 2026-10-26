import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";

export default defineConfig({
  root: fileURLToPath(new URL("./apps/desktop", import.meta.url)),
  plugins: [react(), tailwindcss()],
  clearScreen: false,
  server: {
    host: "0.0.0.0",
    port: 5173,
    strictPort: true,
    proxy: {
      "/files": process.env.STUDY_WEB_BRIDGE_URL ?? "http://127.0.0.1:5201",
      "/__study": process.env.STUDY_WEB_BRIDGE_URL ?? "http://127.0.0.1:5201",
      "/rpc": process.env.STUDY_WEB_BRIDGE_URL ?? "http://127.0.0.1:5201",
    },
  },
  build: { outDir: "dist", emptyOutDir: true },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    restoreMocks: true,
  },
});
