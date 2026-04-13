let analyticsTrendChart = null;

function formatPercent(value) {
    return `${Number(value || 0).toFixed(1)}%`;
}

function formatGeneratedAt(isoDate) {
    if (!isoDate) return 'No analytics data yet.';

    return `Updated ${new Date(isoDate).toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    })}`;
}

function setText(id, value) {
    const element = document.getElementById(id);
    if (element) {
        element.textContent = value;
    }
}

function renderTopEvents(events) {
    const list = document.getElementById('topEventsList');
    if (!list) return;

    list.innerHTML = '';

    if (!events.length) {
        const empty = document.createElement('p');
        empty.className = 'analytics-empty-state';
        empty.textContent = 'No events tracked yet.';
        list.appendChild(empty);
        return;
    }

    events.forEach((event) => {
        const item = document.createElement('div');
        item.className = 'analytics-event-item';

        const name = document.createElement('span');
        name.textContent = event.eventName;

        const count = document.createElement('strong');
        count.textContent = String(event.count);

        item.appendChild(name);
        item.appendChild(count);
        list.appendChild(item);
    });
}

function renderSignals(summary) {
    const list = document.getElementById('signalsList');
    if (!list) return;

    list.innerHTML = '';

    const signals = [
        `Form start rate is ${formatPercent(summary.conversion.formStartRate)}.`,
        `Assessment completion rate is ${formatPercent(summary.conversion.assessmentCompletionRate)}.`,
        `Started assessments convert at ${formatPercent(summary.conversion.assessmentFromStartRate)}.`,
        `Chat open rate is ${formatPercent(summary.conversion.chatOpenRate)}.`,
        `${summary.totals.exampleDataUses} example-data uses and ${summary.totals.draftRestores} draft restores have been recorded.`,
        `${summary.totals.historySyncSaves} sync saves and ${summary.totals.historySyncLoads} sync loads have been recorded.`
    ];

    signals.forEach((text) => {
        const item = document.createElement('div');
        item.className = 'analytics-signal-item';
        item.textContent = text;
        list.appendChild(item);
    });
}

function renderFunnel(summary) {
    const container = document.getElementById('analyticsFunnel');
    if (!container) return;

    container.innerHTML = '';

    const steps = [
        {
            label: 'Page Views',
            value: summary.totals.pageViews,
            rate: summary.totals.pageViews ? 100 : 0,
            helper: 'All tracked visits'
        },
        {
            label: 'Form Starts',
            value: summary.totals.formStarts,
            rate: summary.conversion.formStartRate,
            helper: 'Visitors who began the assessment'
        },
        {
            label: 'Assessments Completed',
            value: summary.totals.assessmentsCompleted,
            rate: summary.conversion.assessmentCompletionRate,
            helper: 'Visitors who finished the health check'
        }
    ];

    steps.forEach((step) => {
        const item = document.createElement('div');
        item.className = 'analytics-funnel-step';

        const topRow = document.createElement('div');
        topRow.className = 'analytics-funnel-top';

        const label = document.createElement('strong');
        label.textContent = step.label;

        const meta = document.createElement('span');
        meta.textContent = `${step.value} · ${formatPercent(step.rate)}`;

        topRow.appendChild(label);
        topRow.appendChild(meta);

        const track = document.createElement('div');
        track.className = 'analytics-funnel-track';

        const fill = document.createElement('div');
        fill.className = 'analytics-funnel-fill';
        fill.style.width = `${Math.max(0, Math.min(Number(step.rate || 0), 100))}%`;
        track.appendChild(fill);

        const helper = document.createElement('p');
        helper.className = 'analytics-funnel-helper';
        helper.textContent = step.helper;

        item.appendChild(topRow);
        item.appendChild(track);
        item.appendChild(helper);
        container.appendChild(item);
    });
}

function renderTrendChart(recentDaily) {
    const canvas = document.getElementById('analyticsTrendChart');
    if (!canvas || typeof Chart === 'undefined') return;

    const labels = recentDaily.map((entry) =>
        new Date(entry.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    );

    if (analyticsTrendChart) {
        analyticsTrendChart.destroy();
    }

    analyticsTrendChart = new Chart(canvas, {
        type: 'line',
        data: {
            labels,
            datasets: [
                {
                    label: 'Page Views',
                    data: recentDaily.map((entry) => entry.pageViews),
                    borderColor: '#3b82f6',
                    backgroundColor: 'rgba(59, 130, 246, 0.12)',
                    fill: true,
                    tension: 0.35
                },
                {
                    label: 'Assessments',
                    data: recentDaily.map((entry) => entry.assessmentsCompleted),
                    borderColor: '#10b981',
                    backgroundColor: 'rgba(16, 185, 129, 0.1)',
                    fill: true,
                    tension: 0.35
                },
                {
                    label: 'Chat Opens',
                    data: recentDaily.map((entry) => entry.chatOpens),
                    borderColor: '#f97316',
                    backgroundColor: 'rgba(249, 115, 22, 0.1)',
                    fill: true,
                    tension: 0.35
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'bottom'
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: {
                        precision: 0
                    }
                }
            }
        }
    });
}

async function loadAnalyticsSummary() {
    try {
        const response = await fetch('/api/analytics/summary');
        if (!response.ok) {
            throw new Error('Failed to load analytics summary');
        }

        const summary = await response.json();
        setText('pageViewsValue', String(summary.totals.pageViews));
        setText('formStartsValue', String(summary.totals.formStarts));
        setText('assessmentsCompletedValue', String(summary.totals.assessmentsCompleted));
        setText('formStartRateValue', formatPercent(summary.conversion.formStartRate));
        setText('completionRateValue', formatPercent(summary.conversion.assessmentCompletionRate));
        setText('startToCompleteRateValue', formatPercent(summary.conversion.assessmentFromStartRate));
        setText('chatOpenRateValue', formatPercent(summary.conversion.chatOpenRate));
        setText('uniqueSessionsValue', String(summary.totals.uniqueSessions));
        setText(
            'averageScoreValue',
            summary.assessment.averageScore === null ? '--' : String(summary.assessment.averageScore)
        );
        setText(
            'onboardingHelpersValue',
            `${summary.totals.exampleDataUses} / ${summary.totals.draftRestores}`
        );
        setText('generatedAtText', formatGeneratedAt(summary.generatedAt));

        renderTopEvents(summary.topEvents || []);
        renderSignals(summary);
        renderFunnel(summary);
        renderTrendChart(summary.recentDaily || []);
    } catch (error) {
        console.error(error);
        setText('generatedAtText', 'Unable to load analytics summary.');
    }
}

window.addEventListener('load', loadAnalyticsSummary);
