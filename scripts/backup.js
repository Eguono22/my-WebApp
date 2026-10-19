const fs = require('node:fs/promises');
const path = require('node:path');
const { randomBytes, createCipheriv, createDecipheriv } = require('node:crypto');

function encryptionKey() {
    const value = process.env.BACKUP_ENCRYPTION_KEY || '';
    if (!/^[a-f0-9]{64}$/i.test(value)) throw new Error('BACKUP_ENCRYPTION_KEY must be 64 hex characters. Keep a secure copy outside the backup location.');
    return Buffer.from(value, 'hex');
}

function encryptBackup(payload, key) {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const ciphertext = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()]);
    return JSON.stringify({ version: 1, iv: iv.toString('hex'), tag: cipher.getAuthTag().toString('hex'), ciphertext: ciphertext.toString('base64') });
}

function decryptBackup(value, key) {
    const envelope = JSON.parse(value);
    if (envelope.version !== 1) throw new Error('Unsupported backup format.');
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.iv, 'hex'));
    decipher.setAuthTag(Buffer.from(envelope.tag, 'hex'));
    const payload = JSON.parse(Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext, 'base64')), decipher.final()]).toString('utf8'));
    if (!Array.isArray(payload.syncedProfiles) || !Array.isArray(payload.analyticsEvents)) throw new Error('Invalid backup contents.');
    return payload;
}

async function run() {
    const key = encryptionKey();
    if (process.argv[2] === '--verify') {
        decryptBackup(await fs.readFile(process.argv[3], 'utf8'), key);
        console.log('Encrypted backup integrity verified.');
        return;
    }
    const base = new URL(process.env.PRODUCTION_URL || 'https://my-web-app-eguono22s-projects.vercel.app');
    if (base.protocol !== 'https:') throw new Error('Backups require HTTPS.');
    if (!process.env.ANALYTICS_ADMIN_PASSWORD) throw new Error('ANALYTICS_ADMIN_PASSWORD is required.');
    const response = await fetch(new URL('/api/admin/export', base), {
        headers: { Authorization: `Basic ${Buffer.from(`admin:${process.env.ANALYTICS_ADMIN_PASSWORD}`).toString('base64')}` },
        signal: AbortSignal.timeout(60000)
    });
    if (!response.ok) throw new Error(`Backup export failed (HTTP ${response.status}).`);
    const payload = await response.json();
    if (!Array.isArray(payload.syncedProfiles) || !Array.isArray(payload.analyticsEvents)) throw new Error('Invalid export response.');
    const encrypted = encryptBackup(payload, key);
    decryptBackup(encrypted, key);
    const directory = process.env.BACKUP_DIRECTORY || path.join(__dirname, '..', 'backups');
    await fs.mkdir(directory, { recursive: true, mode: 0o700 });
    const file = path.join(directory, `health-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.enc.json`);
    await fs.writeFile(file, encrypted, { mode: 0o600 });
    console.log(`Encrypted backup saved and verified: ${file}`);
}

if (require.main === module) run().catch((error) => { console.error(error.message); process.exitCode = 1; });
module.exports = { encryptBackup, decryptBackup };
