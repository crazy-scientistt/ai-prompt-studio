import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests',
  timeout: 150_000,
  retries: 0,
  workers: 1,
  use: {
    baseURL: 'http://localhost:5174',
    screenshot: 'only-on-failure',
    actionTimeout: 10_000,
  },
  reporter: [['list']],
})
