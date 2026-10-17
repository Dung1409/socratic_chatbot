import { defineConfig } from "@playwright/test";
import path from "node:path";

export default defineConfig({
  testDir: "./e2e",
  workers: 1,
  retries: 0,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:8011",
    viewport: { width: 1440, height: 1000 },
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    launchOptions: { channel: "chrome" },
  },
  webServer: {
    command: `${process.platform === "win32" ? "..\\.venv\\Scripts\\python.exe" : "../.venv/bin/python"} -m uvicorn backend.app.main:app --app-dir .. --host 127.0.0.1 --port 8011`,
    url: "http://127.0.0.1:8011/api/health",
    reuseExistingServer: false,
    env: {
      DATABASE_PATH: path.resolve("../backend/data", `e2e-${Date.now()}.db`),
      JWT_SECRET: "e2e-test-only-signing-key-with-more-than-thirty-two-bytes",
      AUTH_ALLOWED_ORIGINS: "http://127.0.0.1:8011",
      AUTH_COOKIE_SECURE: "false",
    },
  },
});
