import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig, devices } from "@playwright/test";

const apiPort = 3311;
const webPort = 5178;

export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.spec.ts",
  fullyParallel: false,
  workers: 1,
  timeout: 300_000,
  expect: { timeout: 15_000 },
  reporter: "list",
  outputDir: "test-results",
  use: {
    baseURL: `http://127.0.0.1:${webPort}`,
    trace: "retain-on-failure",
    viewport: { width: 1440, height: 900 },
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: "npm run dev --workspace @vitalis/api",
      url: `http://127.0.0.1:${apiPort}/api/health`,
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        PORT: String(apiPort),
        DATABASE_PATH: process.env.DATABASE_PATH ?? join(tmpdir(), "vitalis-playwright.sqlite"),
        CORS_ORIGINS: `http://127.0.0.1:${webPort}`,
      },
    },
    {
      command: "npm run dev --workspace @vitalis/web",
      url: `http://127.0.0.1:${webPort}`,
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        VITE_DEV_PORT: String(webPort),
        VITE_DEV_API_PROXY: `http://127.0.0.1:${apiPort}`,
        VITE_API_URL: `http://127.0.0.1:${apiPort}`,
      },
    },
  ],
});
