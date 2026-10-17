import { defineConfig } from "@playwright/test";

const proxy = process.env.HTTPS_PROXY;

export default defineConfig({
  testDir: "e2e",
  timeout: 120_000,
  expect: { timeout: 30_000 },
  workers: 1,
  use: {
    baseURL: process.env.BASE_URL ?? "http://localhost:3000",
    locale: "sq-AL",
    viewport: { width: 1440, height: 900 },
    // Behind a corporate/sandbox proxy, keep the local server direct.
    launchOptions: proxy ? { args: [`--proxy-server=${proxy}`, "--proxy-bypass-list=localhost;127.0.0.1"] } : {},
    screenshot: "only-on-failure",
  },
  webServer: process.env.BASE_URL
    ? undefined
    : { command: "pnpm --filter @cv/web dev", url: "http://localhost:3000", reuseExistingServer: true, timeout: 120_000 },
});
