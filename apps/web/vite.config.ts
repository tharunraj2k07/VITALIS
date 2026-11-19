import { resolve } from "node:path";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, resolve(process.cwd(), "../.."), "");
  return {
    plugins: [react()],
    envDir: "../..",
    server: {
      port: Number(process.env.VITE_DEV_PORT ?? env.VITE_DEV_PORT ?? 5173),
      proxy: { "/api": process.env.VITE_DEV_API_PROXY ?? env.VITE_DEV_API_PROXY ?? "http://localhost:3001" },
    },
    build: {
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (!id.includes("node_modules")) return undefined;
            if (id.includes("/recharts/") || id.includes("/d3-")) return "charts";
            if (id.includes("/react/") || id.includes("/react-dom/") || id.includes("/scheduler/")) return "react-vendor";
            if (id.includes("/dexie/")) return "offline-vendor";
            return "vendor";
          },
        },
      },
    },
    test: { environment: "node" },
  };
});
