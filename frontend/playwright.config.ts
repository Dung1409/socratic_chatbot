import { defineConfig } from "@playwright/test";
import path from "node:path";

const python =
  process.platform === "win32" ? "..\\.venv\\Scripts\\python.exe" : "../.venv/bin/python";
const testEnvironment = {
  JWT_SECRET: "e2e-test-only-signing-key-with-more-than-thirty-two-bytes",
  AUTH_COOKIE_SECURE: "false",
  OPENAI_API_KEY: "",
  PYTHON_DOTENV_DISABLED: "1",
  DATABASE_URL: "",
  PGHOST: "",
  BACKGROUND_JOBS: "false",
};

export default defineConfig({
  testDir: "./e2e",
  workers: 1,
  timeout: 60000,
  retries: 0,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:8011",
    viewport: { width: 1440, height: 1000 },
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    launchOptions: { channel: "chrome" },
  },
  webServer: [
    {
      command: `${python} -m uvicorn backend.app.main:app --app-dir .. --host 127.0.0.1 --port 8011`,
      url: "http://127.0.0.1:8011/api/health",
      reuseExistingServer: false,
      env: {
        DATABASE_PATH: path.resolve("../backend/data", `e2e-${Date.now()}.db`),
        ...testEnvironment,
        TUTOR_MODE: "template",
        AUTH_ALLOWED_ORIGINS: "http://127.0.0.1:8011",
        AUTH_COOKIE_SECURE: "false",
      },
    },
    {
      command: `${python} -m uvicorn backend.tests.e2e_app:app --app-dir .. --host 127.0.0.1 --port 8012`,
      url: "http://127.0.0.1:8012/api/health",
      reuseExistingServer: false,
      env: {
        ...testEnvironment,
        DATABASE_PATH: path.resolve("../backend/data", `e2e-adaptive-${Date.now()}.db`),
        AUTH_ALLOWED_ORIGINS: "http://127.0.0.1:8012",
      },
    },
  ],
});
