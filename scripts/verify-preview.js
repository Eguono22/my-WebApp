const { spawn } = require('node:child_process');
const assert = require('node:assert/strict');
const { verifyDeployment } = require('./verify-deployment');

const base = process.env.PREVIEW_URL;
if (!base) throw new Error('Set PREVIEW_URL to a protected preview deployment.');

function protectedFetch(url, options = {}) {
    return new Promise((resolve, reject) => {
        const route = new URL(url).pathname;
        const args = ['curl', route, '--deployment', base, '--', '--silent', '--show-error', '--max-time', '30', '--write-out', '\n%{http_code}', '--request', options.method || 'GET'];
        let configuration = '';
        for (const [name, value] of new Headers(options.headers).entries()) {
            configuration += `header = ${JSON.stringify(`${name}: ${value}`)}\n`;
        }
        args.push('--config', '-');
        if (options.body) args.push('--data-binary', options.body);
        const child = spawn('vercel', args);
        let stdout = '';
        child.stdout.on('data', (data) => { stdout += data; });
        child.stderr.resume();
        child.on('error', reject);
        child.on('close', (code) => {
            if (code !== 0) return reject(new Error(`Vercel request failed for ${route}.`));
            const separator = stdout.lastIndexOf('\n');
            const status = Number(stdout.slice(separator + 1));
            if (!status) return reject(new Error(`Invalid response for ${route}.`));
            resolve(new Response(stdout.slice(0, separator), { status }));
        });
        child.stdin.end(configuration);
    });
}

async function run() {
    await verifyDeployment(base, protectedFetch);
    const request = (route, options) => protectedFetch(new URL(route, base), options);
    const created = await request('/api/history/profile', { method: 'POST' });
    assert.equal(created.status, 201);
    const { profileId, syncKey } = await created.json();
    const headers = { Authorization: `Bearer ${syncKey.split('.')[1]}`, 'Content-Type': 'application/json' };
    try {
        const saved = await request('/api/history/sync', {
            method: 'POST', headers,
            body: JSON.stringify({ profileId, goalTarget: 85, history: [{ createdAt: new Date().toISOString(), overallScore: 80, status: 'Good', bmi: 23 }] })
        });
        assert.equal(saved.status, 200, 'PostgreSQL save must work.');
        const loaded = await request(`/api/history/sync/${profileId}`, { headers });
        assert.equal((await loaded.json()).history.length, 1, 'PostgreSQL load must return synthetic history.');
        if (process.env.PREVIEW_ADMIN_PASSWORD) {
            const adminHeaders = { Authorization: `Basic ${Buffer.from(`admin:${process.env.PREVIEW_ADMIN_PASSWORD}`).toString('base64')}`, 'Content-Type': 'application/json' };
            const backups = await request('/api/admin/backups', { headers: adminHeaders });
            assert.deepEqual((await backups.json()).backups, [], 'Preview must not expose production snapshots.');
            const exported = await request('/api/admin/export', { headers: adminHeaders });
            assert.equal(exported.status, 200);
            const payload = await exported.json();
            const restored = await request('/api/admin/restore', { method: 'POST', headers: adminHeaders, body: JSON.stringify(payload) });
            assert.equal(restored.status, 200, 'PostgreSQL restore must succeed in isolated preview.');
            const recovered = await request(`/api/history/sync/${profileId}`, { headers });
            assert.equal(recovered.status, 200, 'Original private key must remain valid after PostgreSQL restore.');
        }
    } finally {
        const deleted = await request(`/api/history/sync/${profileId}`, { method: 'DELETE', headers });
        assert.equal(deleted.status, 200, 'Synthetic preview profile must be cleaned up.');
    }
    const removed = await request(`/api/history/sync/${profileId}`, { headers });
    assert.equal(removed.status, 401, 'Deleted profile key must be revoked.');
    console.log('Protected preview PostgreSQL sync, backup/restore, and deletion checks passed.');
}
run().catch((error) => { console.error(error.message); process.exitCode = 1; });
