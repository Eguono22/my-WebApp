const assert = require('node:assert/strict');
const PORT = Number(process.env.SMOKE_TEST_PORT || 3100);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const ANALYTICS_ADMIN_PASSWORD = 'smoke-test-password';

function createAnalyticsAuthHeaders() {
    return {
        Authorization: `Basic ${Buffer.from(`admin:${ANALYTICS_ADMIN_PASSWORD}`).toString('base64')}`
    };
}

async function fetchText(url, options) {
    const response = await fetch(url, options);
    const text = await response.text();
    return { response, text };
}

async function fetchJson(url, options) {
    const response = await fetch(url, options);
    const text = await response.text();
    let json = null;

    if (text) {
        try {
            json = JSON.parse(text);
        } catch {
            json = null;
        }
    }

    return { response, json, text };
}

async function run() {
    process.env.NODE_ENV = 'production';
    process.env.ANALYTICS_ADMIN_PASSWORD = ANALYTICS_ADMIN_PASSWORD;
    const app = require('../server');
    const server = app.listen(PORT);

    try {
        const home = await fetchText(`${BASE_URL}/`);
        assert.equal(home.response.status, 200, 'Home page should return 200.');
        assert.match(home.text, /id="healthForm"/, 'Home page should render the health form.');
        assert.match(
            home.text,
            /id="historyTrendChart"/,
            'Home page should include the history chart canvas.'
        );
        assert.match(
            home.text,
            /id="historyChartHelp"/,
            'Home page should include the history chart helper copy.'
        );
        assert.match(
            home.text,
            /id="historyChartEmpty"/,
            'Home page should include the history chart empty state.'
        );
        assert.match(
            home.text,
            /id="doctorDirectoryList"/,
            'Home page should include the doctor directory list container.'
        );
        assert.match(
            home.text,
            /id="doctorRefreshBtn"/,
            'Home page should include the doctor directory refresh button.'
        );

        const favicon = await fetchText(`${BASE_URL}/favicon.ico`);
        assert.equal(favicon.response.status, 200, 'Favicon route should return 200.');
        assert.match(
            favicon.response.headers.get('content-type') || '',
            /image\/svg\+xml/,
            'Favicon route should serve the SVG asset.'
        );

        const health = await fetchJson(`${BASE_URL}/api/health`);
        assert.equal(health.response.status, 200, 'Health endpoint should return 200.');
        assert.equal(health.json?.ok, true, 'Health endpoint should report ok.');
        assert.equal(typeof health.json?.storage, 'string', 'Health endpoint should report storage type.');
        assert.equal(
            health.json?.readiness?.ready,
            true,
            'Health endpoint should report readiness success in local verification.'
        );

        const readiness = await fetchJson(`${BASE_URL}/api/readiness`);
        assert.equal(readiness.response.status, 200, 'Readiness endpoint should return 200 locally.');
        assert.equal(readiness.json?.ok, true, 'Readiness endpoint should report ok.');
        assert.equal(readiness.json?.readiness?.ready, true, 'Readiness endpoint should report ready.');
        assert.equal(
            Array.isArray(readiness.json?.readiness?.checks),
            true,
            'Readiness endpoint should return detailed checks.'
        );

        const doctorDirectory = await fetchJson(`${BASE_URL}/api/doctors/nigeria?limit=5&pages=1`);
        assert.equal(
            doctorDirectory.response.status,
            200,
            'Doctor directory endpoint should return 200.'
        );
        assert.equal(
            Array.isArray(doctorDirectory.json?.doctors),
            true,
            'Doctor directory endpoint should return a doctors array.'
        );
        assert.equal(
            typeof doctorDirectory.json?.cached,
            'boolean',
            'Doctor directory endpoint should report whether the response was cached.'
        );
        assert.equal(
            typeof doctorDirectory.json?.stale,
            'boolean',
            'Doctor directory endpoint should report whether the response was stale.'
        );
        assert.equal(
            typeof doctorDirectory.json?.source,
            'string',
            'Doctor directory endpoint should report its upstream source.'
        );

        const blockedAnalyticsPage = await fetchText(`${BASE_URL}/analytics.html`, {
            redirect: 'manual'
        });
        assert.equal(
            blockedAnalyticsPage.response.status,
            401,
            'Analytics page should require authentication.'
        );

        const analyticsPage = await fetchText(`${BASE_URL}/analytics.html`, {
            headers: createAnalyticsAuthHeaders()
        });
        assert.equal(analyticsPage.response.status, 200, 'Analytics page should return 200.');
        assert.match(
            analyticsPage.text,
            /id="analyticsTrendChart"/,
            'Analytics page should render the trend chart canvas.'
        );

        const blockedSummary = await fetchJson(`${BASE_URL}/api/analytics/summary`);
        assert.equal(
            blockedSummary.response.status,
            401,
            'Analytics summary endpoint should require authentication.'
        );

        const beforeSummary = await fetchJson(`${BASE_URL}/api/analytics/summary`, {
            headers: createAnalyticsAuthHeaders()
        });
        assert.equal(
            beforeSummary.response.status,
            200,
            'Analytics summary endpoint should return 200 before verification events.'
        );

        const sessionId = `smoke-${Date.now()}`;
        const profileId = `smoke${Date.now()}`;

        const pageViewEvent = await fetchJson(`${BASE_URL}/api/analytics/event`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                sessionId,
                eventName: 'page_view',
                properties: { source: 'smoke_test' }
            })
        });
        assert.equal(pageViewEvent.response.status, 200, 'Page-view analytics event should save.');

        const formStartedEvent = await fetchJson(`${BASE_URL}/api/analytics/event`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                sessionId,
                eventName: 'form_started',
                properties: { source: 'smoke_test' }
            })
        });
        assert.equal(
            formStartedEvent.response.status,
            200,
            'Form-started analytics event should save.'
        );

        const assessmentPayload = {
            age: 34,
            weight: 72,
            height: 175,
            systolic: 118,
            diastolic: 76,
            heartRate: 64,
            exerciseHours: 4,
            sleepHours: 7.5,
            stressLevel: 2
        };

        const assessment = await fetchJson(`${BASE_URL}/api/assess`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(assessmentPayload)
        });
        assert.equal(assessment.response.status, 200, 'Assessment endpoint should return 200.');
        assert.equal(typeof assessment.json?.overallScore, 'number', 'Assessment should return a score.');

        const assessmentEvent = await fetchJson(`${BASE_URL}/api/analytics/event`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                sessionId,
                eventName: 'assessment_completed',
                properties: {
                    overallScore: assessment.json.overallScore,
                    status: assessment.json.status
                }
            })
        });
        assert.equal(
            assessmentEvent.response.status,
            200,
            'Assessment-completed analytics event should save.'
        );

        const chatResponse = await fetchJson(`${BASE_URL}/api/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                message: 'Create a 7-day improvement plan',
                context: assessment.json,
                history: [
                    {
                        role: 'user',
                        content: 'Summarize my latest assessment in simple language'
                    }
                ]
            })
        });
        assert.equal(chatResponse.response.status, 200, 'Chat endpoint should return 200.');
        assert.equal(typeof chatResponse.json?.response, 'string', 'Chat endpoint should return text.');
        assert.equal(
            Array.isArray(chatResponse.json?.followUpPrompts),
            true,
            'Chat endpoint should return follow-up prompts.'
        );
        assert.match(
            chatResponse.json?.response || '',
            /7-day|Day 1/i,
            'Chat endpoint should return a structured plan for planning prompts.'
        );

        const syncSave = await fetchJson(`${BASE_URL}/api/history/sync`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                profileId,
                goalTarget: 85,
                history: [
                    {
                        createdAt: new Date().toISOString(),
                        overallScore: assessment.json.overallScore,
                        status: assessment.json.status,
                        bmi: 23.5,
                        exerciseHours: 4,
                        sleepHours: 7.5,
                        stressLevel: 2,
                        heartRate: 64,
                        systolic: 118,
                        diastolic: 76
                    }
                ]
            })
        });
        assert.equal(syncSave.response.status, 200, 'History sync save should return 200.');
        assert.equal(syncSave.json?.ok, true, 'History sync save should confirm success.');

        const syncLoad = await fetchJson(`${BASE_URL}/api/history/sync/${profileId}`);
        assert.equal(syncLoad.response.status, 200, 'History sync load should return 200.');
        assert.equal(syncLoad.json?.history?.length, 1, 'History sync load should return one record.');

        const blockedExport = await fetchJson(`${BASE_URL}/api/admin/export`);
        assert.equal(
            blockedExport.response.status,
            401,
            'Admin export endpoint should require authentication.'
        );

        const exportResponse = await fetchJson(`${BASE_URL}/api/admin/export`, {
            headers: createAnalyticsAuthHeaders()
        });
        assert.equal(exportResponse.response.status, 200, 'Admin export endpoint should return 200.');
        assert.equal(exportResponse.json?.analyticsSummary?.totals?.pageViews >= 1, true, 'Export should include analytics summary data.');
        assert.equal(Array.isArray(exportResponse.json?.analyticsEvents), true, 'Export should include raw analytics events.');
        assert.equal(Array.isArray(exportResponse.json?.syncedProfiles), true, 'Export should include synced profiles.');

        const blockedRestore = await fetchJson(`${BASE_URL}/api/admin/restore`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(exportResponse.json)
        });
        assert.equal(
            blockedRestore.response.status,
            401,
            'Admin restore endpoint should require authentication.'
        );

        const restoreResponse = await fetchJson(`${BASE_URL}/api/admin/restore`, {
            method: 'POST',
            headers: {
                ...createAnalyticsAuthHeaders(),
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(exportResponse.json)
        });
        assert.equal(restoreResponse.response.status, 200, 'Admin restore endpoint should return 200.');
        assert.equal(restoreResponse.json?.ok, true, 'Admin restore should confirm success.');

        const afterSummary = await fetchJson(`${BASE_URL}/api/analytics/summary`, {
            headers: createAnalyticsAuthHeaders()
        });
        assert.equal(
            afterSummary.response.status,
            200,
            'Analytics summary endpoint should return 200 after verification events.'
        );

        const beforeTotals = beforeSummary.json?.totals || {};
        const afterTotals = afterSummary.json?.totals || {};

        assert.equal(
            (afterTotals.totalEvents || 0) - (beforeTotals.totalEvents || 0),
            3,
            'Smoke test should create exactly three analytics events.'
        );
        assert.equal(
            (afterTotals.pageViews || 0) - (beforeTotals.pageViews || 0),
            1,
            'Smoke test should create one page view.'
        );
        assert.equal(
            (afterTotals.formStarts || 0) - (beforeTotals.formStarts || 0),
            1,
            'Smoke test should create one form start.'
        );
        assert.equal(
            (afterTotals.assessmentsCompleted || 0) - (beforeTotals.assessmentsCompleted || 0),
            1,
            'Smoke test should create one completed assessment.'
        );

        console.log('Smoke test passed.');
    } catch (error) {
        console.error('Smoke test failed.');
        console.error(error instanceof Error ? error.stack : error);
        process.exitCode = 1;
    } finally {
        await new Promise((resolve, reject) => {
            server.close((error) => {
                if (error) {
                    reject(error);
                    return;
                }

                resolve();
            });
        });
    }
}

run();
