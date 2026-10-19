# Health Assessment Hub

A rules-based educational wellness app with assessments, guided chat, local history, optional private cloud sync, and protected admin analytics. This is not a diagnostic or clinical records system.

## Run locally

Use Node.js 22 (`nvm use`), then run:

```sh
npm ci
npm start
```

Open http://localhost:3000. The server automatically loads `.env.local`; existing environment values take precedence. Never commit this file.

Configuration:

| Variable | Purpose |
| --- | --- |
| `ANALYTICS_ADMIN_PASSWORD` | Strong administrator password; username is `admin` |
| `DATABASE_URL` | Neon PostgreSQL URL; required on Vercel |
| `CRON_SECRET` | At least 32 characters; authenticates scheduled production backups |
| `BACKUP_ENCRYPTION_KEY` | Optional: 64 hex characters for manually requested encrypted export backups |
| `PRODUCTION_URL` | Used by deployment verification and optional export scripts |
| `DATA_DIRECTORY` | Optional local storage location; tests use temporary directories |
| `STORAGE_DRIVER=json` | Optional local JSON fallback for testing |

Without PostgreSQL, local development uses SQLite or the JSON fallback. Production requires PostgreSQL for durable data.

## Private cloud sync

Create a private key in the app, save a copy securely, then choose Save To Cloud. Paste the same key on another device and choose Load From Cloud. Keys contain a randomly generated profile identifier and a 256-bit secret; the database stores only a SHA-256 digest of the secret. Reading, writing, and deletion require the matching bearer credential. Keys never appear in request URLs. There is no email/password account or key recovery.

Old Profile IDs alone no longer allow access. Legacy records remain available to administrators, but cannot be claimed through the public API. Existing users can create a new private profile and upload their local history.

Saving replaces cloud history. Loading replaces device history. The app asks before replacement. Deleting a cloud profile removes its live record and invalidates the key; deleting device data is a separate action.

## Privacy

Assessment and chat data are processed by this server using rules, without an external generative AI service. Browser history and drafts remain local unless cloud sync is chosen. Analytics is off by default, requires opt-in, and respects Do Not Track. Opting in includes assessment scores, status, and usage events. See `/privacy.html` for retention, external CDN use, backups, and deletion controls.

Clinician listings come from an external directory. Previously fetched listings or an empty state appear if it is unavailable; example contacts are not substituted.

## Verification

```sh
npm run smoke-test
STORAGE_DRIVER=json npm run smoke-test
npx playwright install chromium
npm run test:browser
PRODUCTION_URL=https://your-app.vercel.app npm run verify:deployment
```

On a Mac with Chrome installed, use `CHROME_PATH='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' npm run test:browser` instead of installing Chromium.

Smoke tests use isolated temporary storage and verify assessment validation, chat, profile creation, owner isolation, sync, authentication, backup restoration, and cloud deletion. Browser tests cover desktop and mobile assessments, recovery on a new device, optional analytics, deletion, and the chart-CDN fallback. CI runs SQLite, JSON, and browser checks on Node.js 22.

## Vercel deployment

The linked project is `eguono22s-projects/my-web-app`. Its default production URL is https://my-web-app-wheat.vercel.app.

1. Configure `DATABASE_URL` and separate strong `ANALYTICS_ADMIN_PASSWORD` values for production and preview.
2. Configure production `CRON_SECRET` using a cryptographically random secret.
3. Use `vercel deploy --yes` for a preview. On Vercel previews, tables live in the fixed `health_preview` schema. Production uses `public`. This isolates app records when the same database connection is provisioned to both environments; it is not a separate database credential or permission boundary.
4. Verify the preview, then run `vercel deploy --prod --yes`.
5. For protected preview verification, set `PREVIEW_URL` and run `node scripts/verify-preview.js` using the signed-in Vercel CLI. An optional `PREVIEW_ADMIN_PASSWORD` enables an isolated PostgreSQL export/restore check using synthetic data.
6. Verify `/api/readiness` returns `ready: true`, storage is `postgres`, Node major is 22, and analytics and sync endpoints reject unauthenticated requests.

The database role must be able to create tables and the `health_preview` and `health_backups` schemas. Deployments add a credential-hash column to existing profile tables without deleting existing records. Local databases, secrets, backups, and temporary screenshots are excluded from deployment uploads.

Vercel requires verified Git commits for automatic deployments. Keep that safeguard enabled; unsigned pushes can be canceled even when a direct CLI deployment succeeds. For automatic releases, use signed local commits or GitHub-generated verified merge commits.

Production checks run daily and on main-branch pushes. Override the GitHub repository variable `PRODUCTION_URL` if the production domain changes.

## Cloud backups and recovery

Vercel calls `/api/cron/backup` daily at 06:00 UTC. It requires the production `CRON_SECRET`. Snapshots are built entirely within PostgreSQL and retained in `health_backups.snapshots` for seven days. The admin dashboard also has a Create cloud backup action; `/api/admin/backups` lists snapshot IDs and dates.

These snapshots protect against accidental changes to application tables. They share the database's failure boundary and are not independent disaster-recovery backups. Check the Neon account's point-in-time recovery and retention settings separately; no provider recovery plan is implied by this configuration.

To recover, authenticate as admin, download `/api/admin/backups/<backupId>`, inspect the backup, and use Restore JSON on the analytics dashboard. Restoring replaces all synced profiles and analytics. Account for deletion requests received since the backup was created so deleted records are not unintentionally reintroduced. Backups contain health records and credential digests; treat downloads as sensitive.

The optional manual `npm run backup` script downloads the admin export and encrypts it with AES-256-GCM using `BACKUP_ENCRYPTION_KEY`. It is not enabled on a schedule and should only be run when that data destination is approved. Keep the key separately and securely; losing it makes encrypted exports unrecoverable. `node scripts/backup.js --verify <file>` verifies an encrypted file without printing its records.

## Operational limits

Request limiting is per server instance; it supplements provider edge controls and does not provide a global rate limit. Private keys confer full access to their profile and must be kept safe. The scoring model is educational and has not been clinically validated. No claim of regulatory certification is made.

ISC license. Maintainer: Eguono22.
