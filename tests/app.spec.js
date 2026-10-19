const { test, expect } = require('@playwright/test');

for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
    test(`assessment, private sync, and privacy at ${viewport.width}px`, async ({ page }) => {
        await page.setViewportSize(viewport);
        const failures = [];
        page.on('pageerror', (error) => failures.push(error.message));
        await page.route('**/api/doctors/nigeria**', (route) => route.fulfill({ json: { doctors: [], fetchedAt: null, stale: false, cached: false } }));
        let analyticsRequests = 0;
        page.on('request', (request) => { if (request.url().includes('/api/analytics/event')) analyticsRequests += 1; });
        await page.goto('/');
        await expect(page.locator('#syncLoadBtn')).toBeVisible();
        await expect(page.locator('#analyticsConsent')).not.toBeChecked();
        await page.locator('#useExampleBtn').click();
        await page.locator('.btn-submit').filter({ hasText: 'Generate Assessment' }).click();
        await expect(page.locator('#resultsSection')).toBeVisible();
        await expect(page.locator('#historyList .history-item')).toHaveCount(1);
        expect(analyticsRequests).toBe(0);
        await page.locator('#syncCreateBtn').click();
        await expect(page.locator('#syncActionStatus')).toContainText('Private key created');
        const key = await page.locator('#syncProfileId').inputValue();
        expect(key).toMatch(/^[a-f0-9]{32}\.[a-f0-9]{64}$/);
        page.on('dialog', (dialog) => dialog.accept());
        await page.locator('#syncSaveBtn').click();
        await expect(page.locator('#syncActionStatus')).toHaveText('Cloud history saved.');
        await page.evaluate(() => localStorage.removeItem('healthAssessmentHistoryV1'));
        await page.reload();
        await expect(page.locator('#syncLoadBtn')).toBeVisible();
        await page.locator('#syncLoadBtn').click();
        await expect(page.locator('#historyList .history-item')).toHaveCount(1);
        await page.locator('#syncDeleteBtn').click();
        await expect(page.locator('#syncActionStatus')).toContainText('Cloud profile deleted');
        await expect(page.locator('#syncProfileId')).toHaveValue('');
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        await page.goto('/privacy.html');
        await expect(page.getByRole('heading', { name: 'Privacy & data controls', exact: true })).toBeVisible();
        expect(failures).toEqual([]);
    });
}

test('analytics supports refresh and remains readable without the chart CDN', async ({ browser }) => {
    const context = await browser.newContext({ httpCredentials: { username: 'admin', password: 'browser-test-password' } });
    const page = await context.newPage();
    await page.route('https://cdn.jsdelivr.net/**', (route) => route.abort());
    await page.goto('/analytics.html');
    await expect(page.locator('#analyticsLoadStatus')).toContainText('No activity yet');
    await expect(page.locator('.analytics-trend-table tbody tr')).toHaveCount(7);
    await page.locator('#analyticsRefreshBtn').click();
    await expect(page.locator('#analyticsRefreshBtn')).toBeEnabled();
    await expect(page.locator('#pageViewsValue')).toHaveText('0');
    await context.close();
});
