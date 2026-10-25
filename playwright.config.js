const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests',
  testMatch: '**/*.spec.js',
  use: { baseURL: 'http://127.0.0.1:8010', channel: 'chrome' },
  webServer: [{
    command: 'node scripts/serve.cjs 8010',
    url: 'http://127.0.0.1:8010',
    reuseExistingServer: true,
  }, {
    command: 'node scripts/serve.cjs 8020 --dev',
    url: 'http://127.0.0.1:8020',
    reuseExistingServer: true,
    env: { NODE_ENV: 'development' },
  }, {
    command: 'node scripts/serve.cjs 8021 --dev',
    url: 'http://127.0.0.1:8021',
    reuseExistingServer: true,
    // Isolated test-only production startup configuration; never merchant credentials.
    env: { NODE_ENV: 'production', PUBLIC_BASE_URL: 'https://test.example.invalid', ORDER_ACCESS_SECRET: 'playwright-only-secret-not-for-production', ADMIN_PASSWORD_HASH: 'ab'.repeat(16) + ':' + 'ab'.repeat(64) },
  }, {
    command: 'node scripts/serve.cjs 8030',
    url: 'http://127.0.0.1:8030',
    reuseExistingServer: false,
    env: {
      NODE_ENV: 'test', PUBLIC_BASE_URL: 'http://127.0.0.1:8030',
      DATABASE_PATH: `./test-results/commerce-${Date.now()}.sqlite`,
      ORDER_ACCESS_SECRET: 'isolated-test-order-access-secret-123456',
      ADMIN_PASSWORD_HASH: 'cd'.repeat(16) + ':' + require('node:crypto').scryptSync('isolated-ui-test-password', 'cd'.repeat(16), 64).toString('hex'),
      MP_ACCESS_TOKEN: '', MP_WEBHOOK_SECRET: '',
    },
  }],
});
