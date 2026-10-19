const { defineConfig } = require('@playwright/test');
const os = require('node:os');
const path = require('node:path');
module.exports = defineConfig({
    testDir: './tests',
    timeout: 30000,
    workers: 1,
    use: {
        baseURL: 'http://127.0.0.1:3102',
        launchOptions: process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {},
        screenshot: 'only-on-failure'
    },
    webServer: {
        command: 'node server.js',
        url: 'http://127.0.0.1:3102',
        reuseExistingServer: false,
        env: { PORT: '3102', NODE_ENV: 'production', DATABASE_URL: '', VERCEL: '', ANALYTICS_ADMIN_PASSWORD: 'browser-test-password', DATA_DIRECTORY: path.join(os.tmpdir(), `health-browser-test-${process.pid}`) }
    }
});
