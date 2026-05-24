import { defineConfig, devices } from '@playwright/test';

// E2E tests against the live demo. Vite serves it on :5173; Playwright's
// webServer config boots `npm run dev` and waits for the port to come up.
// Tests live in tests/e2e/ to keep them out of the src/ tree that Vitest
// scans for unit tests.
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  fullyParallel: false,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:5173',
  },
  // Two projects to lock in cap behavior across DPR settings. The 3x project
  // reproduces the bug the user reported on a retina display, since hls.js's
  // cap-level-controller multiplies the player size by devicePixelRatio.
  projects: [
    {
      name: 'chromium-dpr1',
      use: {
        browserName: 'chromium',
        viewport: { width: 1280, height: 800 },
        deviceScaleFactor: 1,
      },
    },
    {
      name: 'chromium-dpr3',
      use: {
        browserName: 'chromium',
        viewport: { width: 1280, height: 800 },
        deviceScaleFactor: 3,
      },
    },
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173/advanced.html',
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
