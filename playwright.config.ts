import { defineConfig, devices } from "@playwright/test";

// Ports tests/e2e/conftest.py's TestServer pattern: run the app locally
// (here: `wrangler dev` against the local D1) and drive it with a real
// browser. `e2e/global-setup.ts` seeds a known e2e admin account, mirroring
// conftest.py's ADMIN_ID/ADMIN_PASSWORD env-seeded admin.
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  // Capped rather than the default (CPU count): all tests share one
  // `wrangler dev` instance (single local D1), and each promote/QR test
  // fetches the qrcode library fresh from a CDN per browser context — high
  // parallelism was observed to cause occasional timeouts under contention.
  workers: 3,
  retries: 1,
  reporter: "list",
  globalSetup: "./e2e/global-setup.ts",
  use: {
    baseURL: "http://localhost:8787",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npx wrangler dev --port 8787",
    url: "http://localhost:8787/health",
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
