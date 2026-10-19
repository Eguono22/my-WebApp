const assert = require('node:assert/strict');

async function verifyDeployment(baseUrl, fetcher = fetch) {
    const url = new URL(baseUrl);
    assert.equal(url.protocol, 'https:', 'Public deployment must use HTTPS.');
    const request = (route, options) => fetcher(new URL(route, url), { signal: AbortSignal.timeout(20000), ...options });
    const home = await request('/');
    assert.equal(home.status, 200, 'Home page must load.');
    assert.match(await home.text(), /id="healthForm"/, 'Home page must contain the assessment.');
    const privacy = await request('/privacy.html');
    assert.equal(privacy.status, 200, 'Privacy page must load.');
    const readiness = await request('/api/readiness');
    assert.equal(readiness.status, 200, 'Readiness endpoint must return 200.');
    const data = await readiness.json();
    assert.equal(data.readiness?.ready, true, 'Production readiness must pass.');
    assert.equal(data.storage, 'postgres', 'Deployment must use PostgreSQL.');
    assert.equal(data.readiness.environment.nodeMajor, 22, 'Deployment must use Node 22.');
    const analytics = await request('/analytics.html', { redirect: 'manual' });
    assert.equal(analytics.status, 401, 'Analytics must require administrator authentication.');
    const history = await request('/api/history/sync/00000000000000000000000000000000');
    assert.equal(history.status, 401, 'Cloud history must require a private key.');
    console.log(`Deployment checks passed: ${url.origin}`);
}

if (require.main === module) {
    verifyDeployment(process.env.PRODUCTION_URL || 'https://healthassessmenthub.com')
        .catch((error) => { console.error(error.message); process.exitCode = 1; });
}
module.exports = { verifyDeployment };
