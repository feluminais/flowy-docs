import { defineConfig, devices } from '@playwright/test'

// The browser page, read from the built UI by the project's own server, over the Plum demo (docs/demo/flowy). Nothing here writes to the
// demo: the server's history goes to a scratch folder.
const port = 4521

export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.ts',
  outputDir: 'results',
  reporter: process.env.CI ? [['list'], ['html', { outputFolder: 'report', open: 'never' }]] : 'list',
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  // Autoplay starts on, but these tests step through flows one stop at a time, so the page opens with it turned off; player.spec.ts checks the default on a fresh page.
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: 'retain-on-failure',
    storageState: { cookies: [], origins: [{ origin: `http://127.0.0.1:${port}`, localStorage: [{ name: 'flowy.autoplay', value: 'off' }] }] },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `node src/cli.ts --dir docs/demo/flowy --port ${port} --no-open`,
    cwd: '..',
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: false,
    env: { FLOWY_STATE_DIR: 'browser-tests/results/state' },
    timeout: 30_000,
  },
})
