// Enhanced Health Assessment App with guided chat support

let currentAssessmentData = null;
const HISTORY_STORAGE_KEY = 'healthAssessmentHistoryV1';
const SCORE_GOAL_STORAGE_KEY = 'healthAssessmentScoreGoalV1';
const SYNC_PROFILE_STORAGE_KEY = 'healthAssessmentSyncProfileV1';
const ANALYTICS_SESSION_STORAGE_KEY = 'healthAssessmentAnalyticsSessionV1';
const FORM_DRAFT_STORAGE_KEY = 'healthAssessmentFormDraftV1';
let trendChart = null;
let selectedHistoryMetric = 'overallScore';
let hasTrackedFormStart = false;
const healthForm = document.getElementById('healthForm');
const healthFormFields = [
    'age',
    'weight',
    'height',
    'systolic',
    'diastolic',
    'heartRate',
    'exerciseHours',
    'sleepHours',
    'stressLevel'
];
const exampleAssessmentProfile = {
    age: '34',
    weight: '72',
    height: '175',
    systolic: '118',
    diastolic: '76',
    heartRate: '64',
    exerciseHours: '4',
    sleepHours: '7.5',
    stressLevel: '2'
};
const NIGERIA_DOCTOR_DIRECTORY = [
    {
        name: 'Dr. Adaeze Nwankwo',
        specialty: 'General Practice',
        location: 'Ikeja, Lagos',
        facility: 'Ikeja Family Health Clinic',
        phone: '+234-803-111-2045'
    },
    {
        name: 'Dr. Ibrahim Yusuf',
        specialty: 'Cardiology',
        location: 'Wuse, Abuja',
        facility: 'HeartCare Specialist Centre',
        phone: '+234-809-442-7118'
    },
    {
        name: 'Dr. Chiamaka Okorie',
        specialty: 'Internal Medicine',
        location: 'GRA, Port Harcourt',
        facility: 'Rivers Wellness Hospital',
        phone: '+234-816-330-5589'
    },
    {
        name: 'Dr. Olumide Adebayo',
        specialty: 'Endocrinology',
        location: 'Ibadan, Oyo',
        facility: 'Bodija Specialist Clinic',
        phone: '+234-802-615-0091'
    },
    {
        name: 'Dr. Zainab Bello',
        specialty: 'Family Medicine',
        location: 'Kaduna North, Kaduna',
        facility: 'Arewa Family Medical Centre',
        phone: '+234-807-524-6622'
    },
    {
        name: 'Dr. Emeka Umeh',
        specialty: 'Pulmonology',
        location: 'Enugu North, Enugu',
        facility: 'Coal City Chest and Wellness Clinic',
        phone: '+234-814-902-3774'
    }
];
let nigeriaDoctorsCache = null;
let nigeriaDoctorsRequest = null;
let nigeriaDoctorsFetchedAt = null;
let doctorDirectoryState = {
    allDoctors: [],
    currentOverallScore: 70
};

async function getNigeriaDoctorDirectory(limit = 30, forceRefresh = false) {
    if (!forceRefresh && Array.isArray(nigeriaDoctorsCache) && nigeriaDoctorsCache.length) {
        return {
            doctors: nigeriaDoctorsCache,
            fallback: false,
            stale: false,
            cached: true,
            fetchedAt: nigeriaDoctorsFetchedAt
        };
    }

    if (!nigeriaDoctorsRequest || forceRefresh) {
        nigeriaDoctorsRequest = fetch(`/api/doctors/nigeria?limit=${encodeURIComponent(limit)}&pages=3&refresh=${forceRefresh ? 'true' : 'false'}`)
            .then(async (response) => {
                if (!response.ok) {
                    throw new Error('Doctor source request failed');
                }

                const payload = await response.json();
                if (!payload || !Array.isArray(payload.doctors)) {
                    throw new Error('Invalid doctor source response');
                }

                nigeriaDoctorsCache = payload.doctors;
                nigeriaDoctorsFetchedAt = payload.fetchedAt || new Date().toISOString();
                return {
                    doctors: nigeriaDoctorsCache,
                    fallback: false,
                    stale: Boolean(payload.stale),
                    cached: Boolean(payload.cached),
                    fetchedAt: nigeriaDoctorsFetchedAt
                };
            })
            .catch((error) => {
                console.error('Unable to load doctor source:', error);
                nigeriaDoctorsCache = NIGERIA_DOCTOR_DIRECTORY;
                return {
                    doctors: nigeriaDoctorsCache,
                    fallback: true,
                    stale: false,
                    cached: false,
                    fetchedAt: null
                };
            })
            .finally(() => {
                nigeriaDoctorsRequest = null;
            });
    }

    return nigeriaDoctorsRequest;
}

function getDoctorDirectoryControls() {
    return {
        cityFilter: document.getElementById('doctorCityFilter'),
        specialtyFilter: document.getElementById('doctorSpecialtyFilter'),
        refreshBtn: document.getElementById('doctorRefreshBtn'),
        updatedLabel: document.getElementById('doctorDirectoryUpdated'),
        directoryCount: document.getElementById('doctorDirectoryCount'),
        directoryList: document.getElementById('doctorDirectoryList')
    };
}

function formatDoctorDirectoryUpdatedText(fetchedAt, options = {}) {
    if (!fetchedAt) {
        return options.fallback ? 'Last updated: backup list in use' : 'Last updated: unavailable';
    }

    const date = new Date(fetchedAt);
    if (Number.isNaN(date.getTime())) {
        return 'Last updated: unavailable';
    }

    const formattedDate = date.toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });

    if (options.stale) {
        return `Last updated: ${formattedDate} (cached)`;
    }

    return `Last updated: ${formattedDate}`;
}

function extractDoctorCities(doctors) {
    const citySet = new Set();

    doctors.forEach((doctor) => {
        String(doctor.location || '')
            .split(',')
            .map((part) => part.trim())
            .filter(Boolean)
            .forEach((part) => {
                if (part.toLowerCase() !== 'nigeria') {
                    citySet.add(part);
                }
            });
    });

    return Array.from(citySet).sort((a, b) => a.localeCompare(b));
}

function updateFilterOptions(selectEl, values, allLabel) {
    if (!selectEl) return;

    const previousValue = selectEl.value;
    selectEl.innerHTML = '';

    const defaultOption = document.createElement('option');
    defaultOption.value = '';
    defaultOption.textContent = allLabel;
    selectEl.appendChild(defaultOption);

    values.forEach((value) => {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = value;
        selectEl.appendChild(option);
    });

    if (values.includes(previousValue)) {
        selectEl.value = previousValue;
    }
}

function applyDoctorFilters() {
    const { cityFilter, specialtyFilter } = getDoctorDirectoryControls();
    const cityValue = String(cityFilter?.value || '').trim().toLowerCase();
    const specialtyValue = String(specialtyFilter?.value || '').trim().toLowerCase();

    return doctorDirectoryState.allDoctors.filter((doctor) => {
        const doctorLocation = String(doctor.location || '').toLowerCase();
        const doctorSpecialty = String(doctor.specialty || '').toLowerCase();

        const cityMatches = !cityValue || doctorLocation.includes(cityValue);
        const specialtyMatches = !specialtyValue || doctorSpecialty === specialtyValue;

        return cityMatches && specialtyMatches;
    });
}

function renderDoctorCards(doctors) {
    const { directoryList, directoryCount } = getDoctorDirectoryControls();

    if (!directoryList || !directoryCount) {
        return;
    }

    directoryList.innerHTML = '';
    directoryCount.textContent = `Showing ${doctors.length} of ${doctorDirectoryState.allDoctors.length} doctors`;

    if (!doctors.length) {
        directoryList.innerHTML = '<p class="doctor-loading">No doctors match this filter. Try a different city or specialty.</p>';
        return;
    }

    doctors.forEach((doctor) => {
        const doctorCard = document.createElement('article');
        doctorCard.className = 'doctor-card';

        const safePhone = String(doctor.phone || '').trim();
        const whatsappDigits = safePhone.replace(/[^\d]/g, '');
        const hasPhone = Boolean(whatsappDigits);
        const profileUrl = String(doctor.profileUrl || '').trim();

        doctorCard.innerHTML = `
            <h4>${doctor.name}</h4>
            <p class="doctor-meta">
                <i class="fas fa-stethoscope"></i>
                ${doctor.specialty || 'General Practice'}
            </p>
            <p class="doctor-meta">
                <i class="fas fa-hospital"></i>
                ${doctor.facility || 'Clinic details on profile'}
            </p>
            <p class="doctor-meta">
                <i class="fas fa-location-dot"></i>
                ${doctor.location || 'Nigeria'}
            </p>
            ${hasPhone ? `
                <a class="doctor-phone" href="tel:${safePhone}">
                    <i class="fas fa-phone"></i>
                    ${safePhone}
                </a>
            ` : `
                <p class="doctor-phone doctor-no-phone">
                    <i class="fas fa-phone-slash"></i>
                    Phone not listed on source
                </p>
            `}
            ${hasPhone ? `
                <a class="doctor-whatsapp" href="https://wa.me/${whatsappDigits}" target="_blank" rel="noopener noreferrer">
                    <i class="fab fa-whatsapp"></i>
                    Chat on WhatsApp
                </a>
            ` : ''}
            ${profileUrl ? `
                <a class="doctor-profile" href="${profileUrl}" target="_blank" rel="noopener noreferrer">
                    <i class="fas fa-up-right-from-square"></i>
                    Open Profile
                </a>
            ` : ''}
        `;

        directoryList.appendChild(doctorCard);
    });
}

function bindDoctorDirectoryControls() {
    const { cityFilter, specialtyFilter, refreshBtn } = getDoctorDirectoryControls();

    if (cityFilter && cityFilter.dataset.bound !== 'true') {
        cityFilter.dataset.bound = 'true';
        cityFilter.addEventListener('change', () => {
            renderDoctorCards(applyDoctorFilters());
        });
    }

    if (specialtyFilter && specialtyFilter.dataset.bound !== 'true') {
        specialtyFilter.dataset.bound = 'true';
        specialtyFilter.addEventListener('change', () => {
            renderDoctorCards(applyDoctorFilters());
        });
    }

    if (refreshBtn && refreshBtn.dataset.bound !== 'true') {
        refreshBtn.dataset.bound = 'true';
        refreshBtn.addEventListener('click', () => {
            renderDoctorDirectory(doctorDirectoryState.currentOverallScore, true);
        });
    }
}

function getAnalyticsSessionId() {
    let sessionId = sessionStorage.getItem(ANALYTICS_SESSION_STORAGE_KEY);
    if (!sessionId) {
        sessionId = `session-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
        sessionStorage.setItem(ANALYTICS_SESSION_STORAGE_KEY, sessionId);
    }
    return sessionId;
}

async function trackEvent(eventName, properties = {}) {
    try {
        await fetch('/api/analytics/event', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                sessionId: getAnalyticsSessionId(),
                eventName,
                properties
            })
        });
    } catch (error) {
        console.error('Analytics tracking failed:', error);
    }
}

const HISTORY_METRICS = {
    overallScore: {
        label: 'Overall Score',
        chartTitle: 'Overall Health Score Frequency',
        color: '#667eea',
        min: 0,
        max: 100,
        stepSize: 20,
        binSize: 10,
        precision: 0
    },
    bmi: {
        label: 'BMI',
        chartTitle: 'BMI Frequency',
        color: '#f97316',
        min: 10,
        max: 45,
        stepSize: 5,
        binSize: 2.5,
        precision: 1
    },
    sleepHours: {
        label: 'Sleep (hours/night)',
        chartTitle: 'Sleep Frequency',
        color: '#06b6d4',
        min: 0,
        max: 12,
        stepSize: 2,
        binSize: 1,
        precision: 0
    },
    exerciseHours: {
        label: 'Exercise (hours/week)',
        chartTitle: 'Exercise Frequency',
        color: '#22c55e',
        min: 0,
        max: 12,
        stepSize: 2,
        binSize: 1,
        precision: 0
    },
    stressLevel: {
        label: 'Stress Level',
        chartTitle: 'Stress Level Frequency',
        color: '#ef4444',
        min: 1,
        max: 5,
        stepSize: 1,
        binSize: 1,
        precision: 0
    },
    heartRate: {
        label: 'Heart Rate (bpm)',
        chartTitle: 'Heart Rate Frequency',
        color: '#ec4899',
        min: 40,
        max: 120,
        stepSize: 10,
        binSize: 10,
        precision: 0
    },
    systolic: {
        label: 'Systolic BP (mmHg)',
        chartTitle: 'Systolic Blood Pressure Frequency',
        color: '#8b5cf6',
        min: 70,
        max: 180,
        stepSize: 10,
        binSize: 10,
        precision: 0
    },
    diastolic: {
        label: 'Diastolic BP (mmHg)',
        chartTitle: 'Diastolic Blood Pressure Frequency',
        color: '#a855f7',
        min: 40,
        max: 120,
        stepSize: 10,
        binSize: 10,
        precision: 0
    }
};

function formatFrequencyEdge(value, precision = 0) {
    return Number(value.toFixed(precision)).toString();
}

function buildFrequencyDistribution(history, metricConfig) {
    const values = history
        .map((entry) => entry[selectedHistoryMetric])
        .filter((value) => typeof value === 'number' && Number.isFinite(value));

    const labels = [];
    const counts = [];
    const binSize = metricConfig.binSize || metricConfig.stepSize || 1;
    const precision = metricConfig.precision || 0;

    for (let start = metricConfig.min; start < metricConfig.max; start += binSize) {
        const end = Math.min(metricConfig.max, start + binSize);
        labels.push(
            `${formatFrequencyEdge(start, precision)}-${formatFrequencyEdge(end, precision)}`
        );
        counts.push(0);
    }

    values.forEach((value) => {
        const clampedValue = Math.max(metricConfig.min, Math.min(metricConfig.max, value));
        let index = Math.floor((clampedValue - metricConfig.min) / binSize);

        if (index >= counts.length) {
            index = counts.length - 1;
        }

        if (index >= 0) {
            counts[index] += 1;
        }
    });

    return { labels, counts, valueCount: values.length };
}

function getFormDraft() {
    try {
        const rawDraft = localStorage.getItem(FORM_DRAFT_STORAGE_KEY);
        if (!rawDraft) return null;
        const parsedDraft = JSON.parse(rawDraft);
        return parsedDraft && typeof parsedDraft === 'object' ? parsedDraft : null;
    } catch (error) {
        console.error('Failed to read form draft:', error);
        return null;
    }
}

function saveFormDraft() {
    try {
        const draft = {};
        healthFormFields.forEach((fieldId) => {
            const field = document.getElementById(fieldId);
            if (field && field.value !== '') {
                draft[fieldId] = field.value;
            }
        });

        if (Object.keys(draft).length) {
            localStorage.setItem(FORM_DRAFT_STORAGE_KEY, JSON.stringify(draft));
        } else {
            localStorage.removeItem(FORM_DRAFT_STORAGE_KEY);
        }
    } catch (error) {
        console.error('Failed to save form draft:', error);
    }
}

function clearFormDraft() {
    localStorage.removeItem(FORM_DRAFT_STORAGE_KEY);
}

function populateHealthForm(values) {
    healthFormFields.forEach((fieldId) => {
        const field = document.getElementById(fieldId);
        if (field && Object.prototype.hasOwnProperty.call(values, fieldId)) {
            field.value = values[fieldId];
        }
    });

    saveFormDraft();
    updateFormProgress();
}

function trackFormStarted(source = 'field_input') {
    if (hasTrackedFormStart) {
        return;
    }

    hasTrackedFormStart = true;
    trackEvent('form_started', { source });
}

function updateFormProgress() {
    const completedFields = healthFormFields.filter((fieldId) => {
        const field = document.getElementById(fieldId);
        return field && field.value !== '';
    }).length;
    const completionRate = Math.round((completedFields / healthFormFields.length) * 100);

    const progressText = document.getElementById('formProgressText');
    const progressPill = document.getElementById('formProgressPill');
    const progressBar = document.getElementById('formProgressBar');

    if (progressText) {
        progressText.textContent = `${completedFields} of ${healthFormFields.length} fields completed`;
    }

    if (progressPill) {
        progressPill.textContent = `${completionRate}%`;
    }

    if (progressBar) {
        progressBar.style.width = `${completionRate}%`;
    }
}

function initializeFormExperience() {
    healthFormFields.forEach((fieldId) => {
        const field = document.getElementById(fieldId);
        if (!field) return;

        field.addEventListener('input', () => {
            trackFormStarted('field_input');
            saveFormDraft();
            updateFormProgress();
        });

        field.addEventListener('change', () => {
            trackFormStarted('field_change');
            saveFormDraft();
            updateFormProgress();
        });
    });

    const useExampleBtn = document.getElementById('useExampleBtn');
    if (useExampleBtn) {
        useExampleBtn.addEventListener('click', () => {
            trackFormStarted('example_data');
            populateHealthForm(exampleAssessmentProfile);
            trackEvent('form_example_used', {
                source: 'onboarding_card'
            });
            showNotification('Sample values loaded. Review and adjust anything before generating your assessment.', 'success');
        });
    }

    const clearDraftBtn = document.getElementById('clearDraftBtn');
    if (clearDraftBtn) {
        clearDraftBtn.addEventListener('click', () => {
            healthForm.reset();
            clearFormDraft();
            updateFormProgress();
            trackEvent('form_draft_cleared');
            showNotification('Draft cleared.', 'success');
        });
    }
}

function getAssessmentWorkspace() {
    return document.querySelector('.assessment-workspace');
}

function formatAssessmentTimestamp(date = new Date()) {
    return date.toLocaleString('en-US', {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
}

function getBloodPressureSummary(systolic, diastolic) {
    if (systolic >= 140 || diastolic >= 90) {
        return 'Elevated range. Consider clinician follow-up, especially if these readings are typical for you.';
    }

    if (systolic >= 120 || diastolic >= 80) {
        return 'Slightly above the ideal range. Lifestyle consistency can make a meaningful difference.';
    }

    return 'Within a generally healthy range for many adults. Keep monitoring over time for consistency.';
}

function getRecoverySummary(sleepHours, stressLevel) {
    const stressLabels = {
        1: 'very low stress',
        2: 'low stress',
        3: 'moderate stress',
        4: 'high stress',
        5: 'very high stress'
    };
    const sleepLabel = sleepHours >= 7 && sleepHours <= 9
        ? 'sleep is in a healthy range'
        : sleepHours < 7
            ? 'sleep appears below the usual recovery target'
            : 'sleep is above the usual target range';
    const stressLabel = stressLabels[stressLevel] || 'stress level not available';

    return `${sleepLabel}, with ${stressLabel} reported this week.`;
}

function getLifestyleSummary(exerciseHours, heartRate) {
    const exerciseLabel = exerciseHours >= 2.5
        ? 'activity volume is solid'
        : exerciseHours > 0
            ? 'activity is present but could be more consistent'
            : 'activity is currently very limited';
    const heartRateLabel = heartRate <= 70
        ? 'resting heart rate looks efficient'
        : heartRate <= 85
            ? 'resting heart rate is reasonable'
            : 'resting heart rate may deserve closer attention';

    return `${exerciseLabel}, and ${heartRateLabel}.`;
}

function getPriorityFocus(result) {
    const detailedScores = result?.detailedScores && typeof result.detailedScores === 'object'
        ? Object.entries(result.detailedScores)
        : [];
    const metricLabels = {
        age: 'Age profile',
        bmi: 'Weight balance',
        bloodPressure: 'Blood pressure',
        heartRate: 'Heart rate',
        exercise: 'Exercise consistency',
        sleep: 'Sleep quality',
        stress: 'Stress management'
    };

    if (!detailedScores.length) {
        return 'Priority focus unavailable';
    }

    const [lowestMetric] = detailedScores.sort((a, b) => a[1] - b[1])[0];
    return `Priority focus: ${metricLabels[lowestMetric] || lowestMetric}`;
}

function getScoreSupportText(score) {
    if (score >= 85) {
        return 'You are in a strong range overall. The best next move is protecting consistency and avoiding backsliding.';
    }

    if (score >= 70) {
        return 'Your foundation looks solid. A few targeted improvements could move this into a more confident range.';
    }

    if (score >= 50) {
        return 'This is a workable starting point. Focused improvements in one or two weak areas should create visible progress.';
    }

    return 'Your results suggest a higher-priority reset. Start with the most strained metric and consider professional guidance if needed.';
}

function getMetricBand(score) {
    if (score >= 85) return 'strong';
    if (score >= 65) return 'moderate';
    return 'attention';
}

function getAssessmentHighlights(result) {
    const metricLabels = {
        age: 'Age profile',
        bmi: 'Weight balance',
        bloodPressure: 'Blood pressure',
        heartRate: 'Heart rate',
        exercise: 'Exercise consistency',
        sleep: 'Sleep quality',
        stress: 'Stress management'
    };
    const metricDescriptions = {
        age: 'A relatively favorable age factor is supporting your overall score.',
        bmi: 'Your weight-to-height balance is one of the healthier parts of this assessment.',
        bloodPressure: 'Blood pressure is helping keep your cardiovascular profile more stable.',
        heartRate: 'Resting heart rate is currently one of your steadier signals.',
        exercise: 'Your activity pattern is one of the strongest contributors right now.',
        sleep: 'Sleep is providing a better recovery base than some of the other metrics.',
        stress: 'Stress management is holding up better than the rest of the profile.'
    };
    const improvementDescriptions = {
        age: 'Age is fixed, so the biggest opportunity is usually improving the lifestyle metrics around it.',
        bmi: 'Small changes in weight balance can positively affect several other health markers.',
        bloodPressure: 'This is the clearest area to monitor more closely because it affects overall risk and daily resilience.',
        heartRate: 'Improving cardiovascular recovery and consistency may help this score move faster.',
        exercise: 'A more reliable movement routine is likely to lift both your score and overall resilience.',
        sleep: 'Better sleep can create spillover gains across recovery, stress, and heart-health signals.',
        stress: 'Reducing stress load may unlock improvements across sleep, recovery, and daily decision-making.'
    };
    const scoredMetrics = Object.entries(result?.detailedScores || {});

    if (!scoredMetrics.length) {
        return {
            strongestMetric: 'Overall profile',
            strongestText: 'A clearer strength summary will appear once detailed scoring is available.',
            weakestMetric: 'Priority area',
            weakestText: 'A clearer focus area will appear once detailed scoring is available.'
        };
    }

    const sortedMetrics = [...scoredMetrics].sort((a, b) => b[1] - a[1]);
    const [strongestMetricKey] = sortedMetrics[0];
    const [weakestMetricKey] = sortedMetrics[sortedMetrics.length - 1];

    return {
        strongestMetric: metricLabels[strongestMetricKey] || strongestMetricKey,
        strongestText: metricDescriptions[strongestMetricKey] || 'This area is one of the stronger parts of your current assessment.',
        weakestMetric: metricLabels[weakestMetricKey] || weakestMetricKey,
        weakestText: improvementDescriptions[weakestMetricKey] || 'This area is the clearest place to focus first.'
    };
}

function renderResultsNarrative(result) {
    const resultsLead = document.getElementById('resultsLead');
    const resultsTimestamp = document.getElementById('resultsTimestamp');
    const resultsPriority = document.getElementById('resultsPriority');
    const scoreSupportText = document.getElementById('scoreSupportText');
    const strengthTitle = document.getElementById('strengthTitle');
    const strengthText = document.getElementById('strengthText');
    const attentionTitle = document.getElementById('attentionTitle');
    const attentionText = document.getElementById('attentionText');
    const bpReading = document.getElementById('bpReading');
    const bpSummary = document.getElementById('bpSummary');
    const recoveryReading = document.getElementById('recoveryReading');
    const recoverySummary = document.getElementById('recoverySummary');
    const lifestyleReading = document.getElementById('lifestyleReading');
    const lifestyleSummary = document.getElementById('lifestyleSummary');

    if (resultsLead) {
        resultsLead.textContent = `Overall score ${result.overallScore}/100, currently rated ${String(result.status).toLowerCase()}.`;
    }

    if (resultsTimestamp) {
        resultsTimestamp.textContent = `Generated ${formatAssessmentTimestamp()}`;
    }

    if (resultsPriority) {
        resultsPriority.textContent = getPriorityFocus(result);
    }

    if (scoreSupportText) {
        scoreSupportText.textContent = getScoreSupportText(Number(result?.overallScore || 0));
    }

    const highlights = getAssessmentHighlights(result);

    if (strengthTitle) {
        strengthTitle.textContent = highlights.strongestMetric;
    }

    if (strengthText) {
        strengthText.textContent = highlights.strongestText;
    }

    if (attentionTitle) {
        attentionTitle.textContent = highlights.weakestMetric;
    }

    if (attentionText) {
        attentionText.textContent = highlights.weakestText;
    }

    if (bpReading) {
        bpReading.textContent = `${currentAssessmentData?.systolic ?? '--'} / ${currentAssessmentData?.diastolic ?? '--'} mmHg`;
    }

    if (bpSummary) {
        bpSummary.textContent = getBloodPressureSummary(
            Number(currentAssessmentData?.systolic || 0),
            Number(currentAssessmentData?.diastolic || 0)
        );
    }

    if (recoveryReading) {
        recoveryReading.textContent = `${currentAssessmentData?.sleepHours ?? '--'}h sleep  |  Stress ${currentAssessmentData?.stressLevel ?? '--'}/5`;
    }

    if (recoverySummary) {
        recoverySummary.textContent = getRecoverySummary(
            Number(currentAssessmentData?.sleepHours || 0),
            Number(currentAssessmentData?.stressLevel || 0)
        );
    }

    if (lifestyleReading) {
        lifestyleReading.textContent = `${currentAssessmentData?.exerciseHours ?? '--'}h activity  |  ${currentAssessmentData?.heartRate ?? '--'} bpm`;
    }

    if (lifestyleSummary) {
        lifestyleSummary.textContent = getLifestyleSummary(
            Number(currentAssessmentData?.exerciseHours || 0),
            Number(currentAssessmentData?.heartRate || 0)
        );
    }
}

// Health Form Submission
healthForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    // Get form data
    const formData = {
        age: parseInt(document.getElementById('age').value),
        weight: parseFloat(document.getElementById('weight').value),
        height: parseFloat(document.getElementById('height').value),
        systolic: parseInt(document.getElementById('systolic').value),
        diastolic: parseInt(document.getElementById('diastolic').value),
        heartRate: parseInt(document.getElementById('heartRate').value),
        exerciseHours: parseFloat(document.getElementById('exerciseHours').value),
        sleepHours: parseFloat(document.getElementById('sleepHours').value),
        stressLevel: parseInt(document.getElementById('stressLevel').value)
    };

    try {
        // Show loading state
        const submitBtn = document.querySelector('.btn-submit');
        const originalText = submitBtn.innerHTML;
        submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Generating Assessment...';
        submitBtn.disabled = true;

        // Call the API
        const response = await fetch('/api/assess', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(formData)
        });

        if (!response.ok) {
            throw new Error('Assessment failed');
        }

        const result = await response.json();
        currentAssessmentData = { ...formData, ...result };
        saveAssessmentToHistory(currentAssessmentData);
        clearFormDraft();
        trackEvent('assessment_completed', {
            overallScore: result.overallScore,
            status: result.status
        });
        
        // Display results
        displayResults(result);
        renderHistorySection();
        
        // Hide form and show results with animation
        const assessmentWorkspace = getAssessmentWorkspace();
        if (assessmentWorkspace) {
            assessmentWorkspace.style.display = 'none';
        }
        document.getElementById('resultsSection').style.display = 'block';
        
        // Scroll to results
        setTimeout(() => {
            document.getElementById('resultsSection').scrollIntoView({ 
                behavior: 'smooth',
                block: 'start'
            });
        }, 100);

    } catch (error) {
        showNotification('The assessment could not be completed. Please review your entries and try again.', 'error');
        console.error('Error:', error);
    } finally {
        // Reset button state
        const submitBtn = document.querySelector('.btn-submit');
        submitBtn.innerHTML = '<i class="fas fa-chart-line"></i> Generate Assessment';
        submitBtn.disabled = false;
    }
});

function displayResults(result) {
    // Display overall score with animation
    const scoreDisplay = document.getElementById('overallScore');
    const scoreStatus = document.getElementById('healthStatus');
    const scoreProgressBar = document.getElementById('scoreProgressBar');
    
    // Animate score counting
    animateValue(scoreDisplay, 0, result.overallScore, 1500);
    scoreStatus.textContent = result.status;
    
    // Set progress bar
    setTimeout(() => {
        scoreProgressBar.style.width = result.overallScore + '%';
    }, 100);
    
    // Set color based on score
    let statusColor;
    if (result.overallScore >= 85) {
        statusColor = '#10b981'; // Green
    } else if (result.overallScore >= 70) {
        statusColor = '#3b82f6'; // Blue
    } else if (result.overallScore >= 50) {
        statusColor = '#f59e0b'; // Yellow
    } else {
        statusColor = '#ef4444'; // Red
    }
    
    scoreDisplay.style.color = statusColor;
    scoreStatus.style.color = statusColor;

    // Display BMI
    const bmiValue = document.getElementById('bmiValue');
    const bmiCategory = document.getElementById('bmiCategory');
    bmiValue.textContent = result.bmi;
    
    // Set BMI category
    let category;
    if (result.bmi < 18.5) {
        category = 'Underweight';
    } else if (result.bmi < 25) {
        category = 'Normal Weight';
    } else if (result.bmi < 30) {
        category = 'Overweight';
    } else {
        category = 'Obese';
    }
    bmiCategory.textContent = category;

    // Display detailed scores
    const detailedScoresContainer = document.getElementById('detailedScores');
    detailedScoresContainer.innerHTML = '';
    
    // Metric name mapping and icons
    const metricLabels = {
        age: { name: 'Age Factor', icon: 'fa-calendar' },
        bmi: { name: 'Body Mass Index', icon: 'fa-weight-scale' },
        bloodPressure: { name: 'Blood Pressure', icon: 'fa-tachometer-alt' },
        heartRate: { name: 'Heart Rate', icon: 'fa-heartbeat' },
        exercise: { name: 'Exercise Level', icon: 'fa-running' },
        sleep: { name: 'Sleep Quality', icon: 'fa-bed' },
        stress: { name: 'Stress Management', icon: 'fa-brain' }
    };
    
    for (const [metric, score] of Object.entries(result.detailedScores)) {
        const scoreItem = document.createElement('div');
        scoreItem.className = `score-item score-item-${getMetricBand(score)}`;
        
        const metricInfo = metricLabels[metric] || { name: metric, icon: 'fa-check' };
        
        scoreItem.innerHTML = `
            <div class="score-item-name-wrap">
                <span class="score-item-name">
                    <i class="fas ${metricInfo.icon}"></i>
                    ${metricInfo.name}
                </span>
                <span class="score-item-band">${getMetricBand(score)}</span>
            </div>
            <div class="score-bar-container">
                <div class="score-bar" style="width: 0%;" data-width="${score}"></div>
            </div>
            <span class="score-item-value">${Math.round(score)}</span>
        `;
        
        detailedScoresContainer.appendChild(scoreItem);
        
        // Animate score bars
        setTimeout(() => {
            const bar = scoreItem.querySelector('.score-bar');
            bar.style.width = bar.dataset.width + '%';
        }, 100);
    }

    // Display recommendations
    const recommendationsList = document.getElementById('recommendationsList');
    recommendationsList.innerHTML = '';
    
    result.recommendations.forEach((recommendation, index) => {
        const li = document.createElement('li');
        li.textContent = recommendation;
        li.style.opacity = '0';
        li.style.transform = 'translateY(10px)';
        recommendationsList.appendChild(li);
        
        // Animate recommendations
        setTimeout(() => {
            li.style.transition = 'all 0.3s ease';
            li.style.opacity = '1';
            li.style.transform = 'translateY(0)';
        }, 100 * (index + 1));
    });

    renderResultsNarrative(result);
    renderDoctorDirectory(result.overallScore);
    updatePostAssessmentCta(result);
    updateChatExperience(`score ${result.overallScore} ${result.status}`);
}

function renderDoctorDirectory(overallScore, forceRefresh = false) {
    const directoryList = document.getElementById('doctorDirectoryList');
    const directoryNote = document.getElementById('doctorDirectoryNote');
    const directoryCount = document.getElementById('doctorDirectoryCount');
    const directoryUpdated = document.getElementById('doctorDirectoryUpdated');

    if (!directoryList || !directoryNote || !directoryCount || !directoryUpdated) {
        return;
    }

    doctorDirectoryState.currentOverallScore = overallScore;
    bindDoctorDirectoryControls();

    if (overallScore < 50) {
        directoryNote.textContent = 'Your score suggests timely clinical follow-up may be appropriate. Contact a provider below and explain your symptoms clearly.';
    } else if (overallScore < 70) {
        directoryNote.textContent = 'A clinical consultation can help translate these results into a safe and realistic improvement plan.';
    } else {
        directoryNote.textContent = 'If you would like personalized clinical advice, you can still consult any provider below.';
    }

    directoryList.innerHTML = '<p class="doctor-loading">Loading clinician directory for Nigeria...</p>';
    directoryCount.textContent = '';
    directoryUpdated.textContent = forceRefresh ? 'Last updated: refreshing...' : formatDoctorDirectoryUpdatedText(nigeriaDoctorsFetchedAt);

    const { cityFilter, specialtyFilter, refreshBtn } = getDoctorDirectoryControls();
    if (refreshBtn) {
        refreshBtn.disabled = true;
    }

    getNigeriaDoctorDirectory(60, forceRefresh).then((result) => {
        doctorDirectoryState.allDoctors = Array.isArray(result.doctors) ? result.doctors : [];

        const cityOptions = extractDoctorCities(doctorDirectoryState.allDoctors);
        const specialtyOptions = Array.from(
            new Set(
                doctorDirectoryState.allDoctors
                    .map((doctor) => String(doctor.specialty || '').trim())
                    .filter(Boolean)
            )
        ).sort((a, b) => a.localeCompare(b));

        updateFilterOptions(cityFilter, cityOptions, 'All Cities');
        updateFilterOptions(specialtyFilter, specialtyOptions, 'All Specialties');

        renderDoctorCards(applyDoctorFilters());
        directoryUpdated.textContent = formatDoctorDirectoryUpdatedText(result.fetchedAt, {
            stale: result.stale,
            fallback: result.fallback
        });

        if (result.fallback) {
            directoryNote.textContent += ' The primary source was temporarily unavailable, so a backup directory is shown.';
        } else if (result.stale) {
            directoryNote.textContent += ' Cached directory data is being shown while the source refreshes.';
        }
    }).catch(() => {
        directoryList.innerHTML = '<p class="doctor-loading">The directory is temporarily unavailable. Please try again shortly.</p>';
        directoryCount.textContent = '';
        directoryUpdated.textContent = formatDoctorDirectoryUpdatedText(nigeriaDoctorsFetchedAt);
    }).finally(() => {
        if (refreshBtn) {
            refreshBtn.disabled = false;
        }
    });
}

function updatePostAssessmentCta(result) {
    const ctaTitle = document.getElementById('ctaTitle');
    const ctaMessage = document.getElementById('ctaMessage');
    const ctaPrimaryBtn = document.getElementById('ctaPrimaryBtn');

    let titleText = 'Next Step';
    let messageText = 'Generate a practical action plan based on your assessment.';
    let buttonText = 'Create Action Plan';
    let aiPrompt = 'Create a practical weekly health action plan from my assessment results.';

    if (result.overallScore >= 85) {
        titleText = 'Maintain Your Momentum';
        messageText = 'Your results are strong. Create a maintenance plan to protect this level of health performance.';
        buttonText = 'Create Maintenance Plan';
        aiPrompt = 'I scored in the excellent range. Create a 7-day maintenance plan to keep my health score high.';
    } else if (result.overallScore >= 70) {
        titleText = 'Move From Good To Stronger';
        messageText = 'A focused weekly plan can help strengthen your lowest-scoring areas.';
        buttonText = 'Create Improvement Plan';
        aiPrompt = 'I scored in the good range. Create a 7-day plan to move from good to excellent health.';
    } else if (result.overallScore >= 50) {
        titleText = 'Start A Focused Recovery Plan';
        messageText = 'Small daily actions can begin improving sleep, activity, recovery, and stress load.';
        buttonText = 'Start 7-Day Plan';
        aiPrompt = 'I scored in the fair range. Give me a simple 7-day recovery plan with daily goals.';
    } else {
        titleText = 'Prioritize Immediate Support';
        messageText = 'Focus on timely professional support and a clear daily routine aimed at early improvement.';
        buttonText = 'Create Priority Plan';
        aiPrompt = 'I scored in needs improvement. Give me a gentle but urgent 7-day plan and tell me what to discuss with a healthcare professional.';
    }

    ctaTitle.innerHTML = `<i class="fas fa-bullseye"></i>${titleText}`;
    ctaMessage.textContent = messageText;
    ctaPrimaryBtn.innerHTML = `<i class="fas fa-route"></i>${buttonText}`;
    ctaPrimaryBtn.dataset.aiPrompt = aiPrompt;
}

function animateValue(element, start, end, duration) {
    const range = end - start;
    const increment = range / (duration / 16);
    let current = start;
    
    const timer = setInterval(() => {
        current += increment;
        if ((increment > 0 && current >= end) || (increment < 0 && current <= end)) {
            current = end;
            clearInterval(timer);
        }
        element.textContent = Math.round(current);
    }, 16);
}

function resetForm() {
    // Reset the form
    healthForm.reset();
    clearFormDraft();
    updateFormProgress();
    currentAssessmentData = null;
    updateChatExperience();
    
    // Show form and hide results
    const assessmentWorkspace = getAssessmentWorkspace();
    if (assessmentWorkspace) {
        assessmentWorkspace.style.display = 'grid';
    }
    document.getElementById('resultsSection').style.display = 'none';
    
    // Scroll to top
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

// AI Chat Functionality
const aiChatBtn = document.getElementById('aiChatBtn');
const aiChatPanel = document.getElementById('aiChatPanel');
const closeChatBtn = document.getElementById('closeChatBtn');
const resetChatBtn = document.getElementById('resetChatBtn');
const chatInput = document.getElementById('chatInput');
const sendChatBtn = document.getElementById('sendChatBtn');
const chatMessages = document.getElementById('chatMessages');
const chatSuggestions = document.getElementById('chatSuggestions');
const chatHeaderHint = document.getElementById('chatHeaderHint');
const chatInputHint = document.getElementById('chatInputHint');
const askAiBtn = document.getElementById('askAiBtn');
const ctaPrimaryBtn = document.getElementById('ctaPrimaryBtn');
const chatContextTitle = document.getElementById('chatContextTitle');
const chatContextSummary = document.getElementById('chatContextSummary');
const chatContextScore = document.getElementById('chatContextScore');
const chatContextPrompt = document.getElementById('chatContextPrompt');
const DEFAULT_CHAT_SUGGESTIONS = [
    'Explain what a strong health score usually indicates',
    'Give me 3 evidence-based stress-reduction habits',
    'How much exercise should I aim for this week?',
    'What does healthy sleep typically look like?'
];
const CHAT_WELCOME_MESSAGE = 'Hello! I am your Health Assistant. I can explain your results in plain language, build a practical plan, and help you decide what to focus on first.';
const chatState = {
    conversation: [],
    lastSuggestedPrompts: DEFAULT_CHAT_SUGGESTIONS
};

function rememberChatTurn(role, content) {
    chatState.conversation.push({
        role,
        content: String(content || '').trim()
    });
    chatState.conversation = chatState.conversation
        .filter((entry) => entry.content)
        .slice(-8);
}

function renderMessageBody(container, text) {
    const lines = String(text || '').split(/\r?\n/);
    let listElement = null;

    const flushList = () => {
        if (listElement) {
            container.appendChild(listElement);
            listElement = null;
        }
    };

    lines.forEach((rawLine) => {
        const line = rawLine.trim();

        if (!line) {
            flushList();
            return;
        }

        if (/^(?:[-*•]|\d+\.)\s+/.test(line)) {
            if (!listElement) {
                listElement = document.createElement('ul');
                listElement.className = 'message-list';
            }

            const item = document.createElement('li');
            item.textContent = line.replace(/^(?:[-*•]|\d+\.)\s+/, '');
            listElement.appendChild(item);
            return;
        }

        flushList();
        const paragraph = document.createElement('p');
        paragraph.textContent = line;
        container.appendChild(paragraph);
    });

    flushList();
}

function resetChatConversation(showToast = false) {
    chatState.conversation = [];
    chatState.lastSuggestedPrompts = DEFAULT_CHAT_SUGGESTIONS;

    if (chatMessages) {
        chatMessages.innerHTML = '';
        addMessage(CHAT_WELCOME_MESSAGE, 'bot', {
            badgeLabel: 'Assistant ready',
            trackInHistory: false,
            keyResponse: false
        });
    }

    updateChatExperience('', DEFAULT_CHAT_SUGGESTIONS);

    if (showToast) {
        showNotification('Health Assistant reset. Start a fresh conversation anytime.', 'success');
    }
}

function openChatPanel(source, prefillMessage = '') {
    aiChatPanel.classList.add('active');
    aiChatBtn.style.display = 'none';
    updateChatExperience();
    chatInput.focus();
    trackEvent('chat_opened', { source });

    if (prefillMessage) {
        setTimeout(() => {
            chatInput.value = prefillMessage;
            chatInput.focus();
            updateChatComposerHint(prefillMessage);
        }, 200);
    }
}

function closeChatPanel() {
    aiChatPanel.classList.remove('active');
    aiChatBtn.style.display = 'flex';
}

function getAssessmentAwareSuggestions() {
    if (!currentAssessmentData) {
        return DEFAULT_CHAT_SUGGESTIONS;
    }

    const suggestions = [];
    const score = Number(currentAssessmentData.overallScore || 0);

    suggestions.push('Summarize my latest assessment in simple language');

    if (score < 50) {
        suggestions.push('What should I improve first this week?');
        suggestions.push('When should I talk to a doctor about these results?');
    } else if (score < 70) {
        suggestions.push('Create a 7-day plan to improve my score');
        suggestions.push('Which metric is holding my score back the most?');
    } else {
        suggestions.push('How can I maintain this score over the next month?');
        suggestions.push('What healthy habit would improve my score the most?');
    }

    suggestions.push('Turn my results into a daily routine');
    return suggestions;
}

function buildFollowUpSuggestions(lastMessage = '') {
    const normalized = String(lastMessage || '').toLowerCase();

    if (normalized.includes('sleep')) {
        return [
            'How do I improve my sleep schedule?',
            'What bedtime habits help most?',
            'How many hours should I target each night?'
        ];
    }

    if (normalized.includes('stress')) {
        return [
            'Give me a 5-minute stress reset',
            'What are signs my stress is too high?',
            'How can I lower stress during work?'
        ];
    }

    if (normalized.includes('exercise') || normalized.includes('workout')) {
        return [
            'Build me a beginner weekly exercise plan',
            'How much cardio do I need?',
            'What if I only have 20 minutes a day?'
        ];
    }

    if (normalized.includes('blood pressure') || normalized.includes('bp') || normalized.includes('heart')) {
        return [
            'What supports healthy blood pressure?',
            'Which foods can help my heart health?',
            'What numbers should I keep an eye on?'
        ];
    }

    return getAssessmentAwareSuggestions();
}

function updateChatHeader() {
    if (!chatHeaderHint) {
        return;
    }

    if (!currentAssessmentData) {
        chatHeaderHint.textContent = 'Ask about your score, sleep, exercise, or the most sensible next step.';
        return;
    }

    const score = Number(currentAssessmentData.overallScore || 0);

    if (score < 50) {
        chatHeaderHint.textContent = `Latest score: ${score}. Let's focus on the safest and most practical first improvements.`;
    } else if (score < 70) {
        chatHeaderHint.textContent = `Latest score: ${score}. I can turn these results into a realistic weekly improvement plan.`;
    } else {
        chatHeaderHint.textContent = `Latest score: ${score}. Let's protect your progress and strengthen your consistency.`;
    }
}

function updateChatContextPanel(lastMessage = '') {
    if (!chatContextTitle || !chatContextSummary || !chatContextScore || !chatContextPrompt) {
        return;
    }

    if (!currentAssessmentData) {
        chatContextTitle.textContent = 'General wellness guidance';
        chatContextSummary.textContent = 'Ask for a plain-language explanation, a weekly plan, or help understanding common health habits.';
        chatContextScore.textContent = 'No score yet';
        chatContextPrompt.textContent = lastMessage
            ? 'Ask a follow-up to your last question'
            : 'Ask what a balanced health routine looks like';
        return;
    }

    const score = Number(currentAssessmentData.overallScore || 0);
    chatContextScore.textContent = `${score}/100 (${currentAssessmentData.status})`;

    if (score < 50) {
        chatContextTitle.textContent = 'Higher-priority improvement planning';
        chatContextSummary.textContent = 'Use the assistant for calm, practical next steps and better questions to raise with a healthcare professional.';
        chatContextPrompt.textContent = 'Ask what to improve first this week';
        return;
    }

    if (score < 70) {
        chatContextTitle.textContent = 'Focused improvement support';
        chatContextSummary.textContent = 'This range is well suited to a focused weekly plan built around your lowest-scoring areas.';
        chatContextPrompt.textContent = 'Ask for a 7-day improvement plan';
        return;
    }

    chatContextTitle.textContent = 'Maintenance and optimization';
    chatContextSummary.textContent = 'Use the assistant to protect your progress, improve consistency, and refine high-value habits.';
    chatContextPrompt.textContent = 'Ask how to maintain this score';
}

function updateChatComposerHint(prefillMessage = '') {
    if (!chatInputHint) {
        return;
    }

    const normalized = String(prefillMessage || chatInput.value || '').toLowerCase();

    if (!normalized) {
        chatInputHint.textContent = currentAssessmentData
            ? 'Try asking for an explanation, a weekly plan, or a habit checklist.'
            : 'You can ask for a plan, an explanation, or a simple wellness recommendation.';
        return;
    }

    if (normalized.includes('plan')) {
        chatInputHint.textContent = 'Ask for a daily, weekly, or beginner-friendly plan.';
        return;
    }

    if (normalized.includes('score') || normalized.includes('result')) {
        chatInputHint.textContent = 'You can ask which metric matters most or where to focus first.';
        return;
    }

    chatInputHint.textContent = 'Press Enter to send, or choose one of the guided prompts above.';
}

function renderChatSuggestions(prompts) {
    if (!chatSuggestions) {
        return;
    }

    chatSuggestions.innerHTML = '';

    prompts.slice(0, 4).forEach((prompt) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'chat-suggestion-chip';
        if (currentAssessmentData) {
            button.classList.add('is-contextual');
        }
        button.textContent = prompt;
        button.addEventListener('click', () => {
            chatInput.value = prompt;
            updateChatComposerHint(prompt);
            sendMessage(prompt, 'suggestion_chip');
        });
        chatSuggestions.appendChild(button);
    });
}

function updateChatExperience(lastMessage = '', promptsOverride = null) {
    updateChatHeader();
    updateChatContextPanel(lastMessage);
    updateChatComposerHint(lastMessage);
    const prompts = Array.isArray(promptsOverride) && promptsOverride.length
        ? promptsOverride
        : buildFollowUpSuggestions(lastMessage);
    chatState.lastSuggestedPrompts = prompts;
    renderChatSuggestions(prompts);
}

// Toggle chat panel
aiChatBtn.addEventListener('click', () => {
    openChatPanel('floating_button');
});

closeChatBtn.addEventListener('click', () => {
    closeChatPanel();
});

if (resetChatBtn) {
    resetChatBtn.addEventListener('click', () => {
        resetChatConversation(true);
        if (chatInput) {
            chatInput.value = '';
            updateChatComposerHint();
            chatInput.focus();
        }
    });
}

// Open chat from results page
if (askAiBtn) {
    askAiBtn.addEventListener('click', () => {
        if (currentAssessmentData) {
            const contextMessage = `I just completed a health assessment. My overall score is ${currentAssessmentData.overallScore} (${currentAssessmentData.status}). Can you help me understand my results better?`;
            openChatPanel('results_follow_up', contextMessage);
            return;
        }

        openChatPanel('results_follow_up');
    });
}

function saveAssessmentToHistory(assessmentData) {
    try {
        const history = getAssessmentHistory();
        const entry = {
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            createdAt: new Date().toISOString(),
            overallScore: assessmentData.overallScore,
            status: assessmentData.status,
            bmi: assessmentData.bmi,
            age: assessmentData.age,
            systolic: assessmentData.systolic,
            diastolic: assessmentData.diastolic,
            heartRate: assessmentData.heartRate,
            exerciseHours: assessmentData.exerciseHours,
            sleepHours: assessmentData.sleepHours,
            stressLevel: assessmentData.stressLevel
        };

        history.push(entry);
        localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(history));
    } catch (error) {
        console.error('Failed to save assessment history:', error);
    }
}

function getAssessmentHistory() {
    try {
        const raw = localStorage.getItem(HISTORY_STORAGE_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
        console.error('Failed to read assessment history:', error);
        return [];
    }
}

function getSavedScoreGoal() {
    const stored = localStorage.getItem(SCORE_GOAL_STORAGE_KEY);
    const parsed = parseInt(stored || '85', 10);
    if (Number.isNaN(parsed)) return 85;
    return Math.min(100, Math.max(1, parsed));
}

function saveScoreGoal(goalValue) {
    localStorage.setItem(SCORE_GOAL_STORAGE_KEY, String(goalValue));
}

function formatHistoryDate(isoDate) {
    const date = new Date(isoDate);
    return date.toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
}

function renderHistorySection() {
    const historySection = document.getElementById('historySection');
    const historyList = document.getElementById('historyList');
    const history = getAssessmentHistory();
    const scoreGoalInput = document.getElementById('scoreGoalInput');
    const scoreGoal = getSavedScoreGoal();

    if (scoreGoalInput && scoreGoalInput.value !== String(scoreGoal)) {
        scoreGoalInput.value = String(scoreGoal);
    }

    if (!history.length) {
        historySection.style.display = 'none';
        return;
    }

    historySection.style.display = 'block';
    historyList.innerHTML = '';

    const sortedHistory = [...history].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    const recent = sortedHistory.slice(0, 8);

    recent.forEach((entry) => {
        const card = document.createElement('div');
        card.className = 'history-item';
        card.innerHTML = `
            <div class="history-item-main">
                <strong>${entry.overallScore}/100</strong>
                <span>${entry.status}</span>
            </div>
            <div class="history-item-meta">
                <span>BMI ${entry.bmi}</span>
                <span>${entry.systolic}/${entry.diastolic} mmHg</span>
                <span>${formatHistoryDate(entry.createdAt)}</span>
            </div>
        `;
        historyList.appendChild(card);
    });

    const chronologicalHistory = [...history].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
    renderTrendChart(chronologicalHistory);
    updateGoalProgress(chronologicalHistory, scoreGoal);
}

function updateGoalProgress(history, scoreGoal) {
    const progressBar = document.getElementById('goalProgressBar');
    const progressText = document.getElementById('goalProgressText');

    if (!progressBar || !progressText) return;
    if (!history.length) {
        progressBar.style.width = '0%';
        progressText.textContent = 'Set a target score to monitor progress over time.';
        return;
    }

    const latest = history[history.length - 1];
    const latestScore = latest.overallScore;
    const percentage = Math.min(100, Math.round((latestScore / scoreGoal) * 100));
    const gap = scoreGoal - latestScore;

    progressBar.style.width = `${percentage}%`;

    if (gap <= 0) {
        progressText.textContent = `Goal reached. Your latest score of ${latestScore} is at or above your target of ${scoreGoal}.`;
        progressBar.style.background = 'linear-gradient(90deg, #10b981 0%, #059669 100%)';
    } else {
        progressText.textContent = `${gap} points remaining. Latest score: ${latestScore}; target: ${scoreGoal}.`;
        progressBar.style.background = 'linear-gradient(90deg, #22c55e 0%, #3b82f6 100%)';
    }
}

function renderTrendChart(history) {
    const canvas = document.getElementById('historyTrendChart');
    if (!canvas || typeof Chart === 'undefined') return;
    const metricConfig = HISTORY_METRICS[selectedHistoryMetric] || HISTORY_METRICS.overallScore;
    const chartHelp = document.getElementById('historyChartHelp');
    const chartEmpty = document.getElementById('historyChartEmpty');
    const { labels, counts, valueCount } = buildFrequencyDistribution(history, metricConfig);

    const trendTitle = document.querySelector('.history-chart-card h3');
    if (trendTitle) {
        trendTitle.innerHTML = `<i class="fas fa-chart-column"></i> ${metricConfig.chartTitle}`;
    }

    if (chartHelp) {
        if (valueCount <= 1) {
            chartHelp.textContent = `Only ${valueCount === 1 ? 'one assessment is' : 'no assessments are'} saved for ${metricConfig.label.toLowerCase()} so far, so this view will become more useful as you add more check-ins.`;
        } else {
            chartHelp.textContent = 'Bars show how many saved assessments fall within each value range.';
        }
    }

    if (chartEmpty) {
        chartEmpty.hidden = valueCount > 0;
    }

    if (trendChart) {
        trendChart.destroy();
    }

    trendChart = new Chart(canvas, {
        type: 'bar',
        data: {
            labels,
            datasets: [
                {
                    label: 'Assessments',
                    data: counts,
                    borderColor: metricConfig.color,
                    backgroundColor: `${metricConfig.color}b3`,
                    borderRadius: 10,
                    borderWidth: 1,
                    hoverBackgroundColor: metricConfig.color,
                    maxBarThickness: 42
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: false
                },
                tooltip: {
                    callbacks: {
                        title(items) {
                            return `${metricConfig.label}: ${items[0].label}`;
                        },
                        label(context) {
                            const count = context.parsed.y;
                            return `${count} assessment${count === 1 ? '' : 's'}`;
                        }
                    }
                }
            },
            scales: {
                x: {
                    grid: {
                        display: false
                    },
                    ticks: {
                        maxRotation: 0,
                        autoSkip: false
                    }
                },
                y: {
                    beginAtZero: true,
                    suggestedMax: Math.max(2, ...counts) + 1,
                    ticks: {
                        stepSize: 1,
                        precision: 0
                    }
                }
            }
        }
    });
}

if (ctaPrimaryBtn) {
    ctaPrimaryBtn.addEventListener('click', () => {
        const prompt = ctaPrimaryBtn.dataset.aiPrompt || 'Create a practical health action plan from my assessment results.';
        openChatPanel('results_cta', prompt);
    });
}

// Send message
sendChatBtn.addEventListener('click', () => {
    sendMessage();
});
chatInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
    }
});
chatInput.addEventListener('input', () => {
    updateChatComposerHint();
});

async function sendMessage(forcedMessage = '', source = 'typed_input') {
    const message = String(forcedMessage || chatInput.value).trim();
    if (!message) return;

    trackEvent('chat_message_sent', {
        hasAssessmentContext: Boolean(currentAssessmentData),
        messageLength: message.length,
        source
    });
    
    // Add user message to chat
    addMessage(message, 'user');
    chatInput.value = '';
    updateChatComposerHint();
    
    // Show typing indicator
    const typingIndicator = addTypingIndicator();
    
    try {
        // Call AI chat API
        const response = await fetch('/api/chat', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                message: message,
                context: currentAssessmentData,
                history: chatState.conversation
            })
        });
        
        if (!response.ok) {
            throw new Error('Chat request failed');
        }
        
        const data = await response.json();
        
        // Remove typing indicator
        typingIndicator.remove();
        
        // Add bot response
        addMessage(data.response, 'bot');
        updateChatExperience(message, data.followUpPrompts);
        
    } catch (error) {
        console.error('Chat error:', error);
        typingIndicator.remove();
        addMessage('I am having trouble connecting right now. Please try again in a moment.', 'bot');
        updateChatExperience(message);
    }
}

function addMessage(text, sender, options = {}) {
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${sender}-message`;

    const now = new Date();
    const timeString = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });

    const contentDiv = document.createElement('div');
    contentDiv.className = 'message-content';
    const shouldHighlight = options.keyResponse !== false && sender === 'bot' && currentAssessmentData;
    if (shouldHighlight) {
        contentDiv.classList.add('is-key-response');
    }

    const messageTag = document.createElement('span');
    messageTag.className = 'message-tag';
    messageTag.innerHTML = sender === 'bot'
        ? '<i class="fas fa-sparkles"></i> Health Assistant'
        : '<i class="fas fa-user"></i> You';

    const messageBody = document.createElement('div');
    messageBody.className = 'message-body';
    renderMessageBody(messageBody, text);

    const timeSpan = document.createElement('span');
    timeSpan.className = 'message-time';
    timeSpan.textContent = timeString;

    const metaRow = document.createElement('div');
    metaRow.className = 'message-meta-row';

    const badge = document.createElement('span');
    badge.className = 'message-badge';
    if (options.badgeLabel) {
        badge.textContent = options.badgeLabel;
    } else {
        badge.innerHTML = sender === 'bot'
            ? '<i class="fas fa-notes-medical"></i> Guided response'
            : '<i class="fas fa-pen"></i> Your question';
    }

    contentDiv.appendChild(messageTag);
    contentDiv.appendChild(messageBody);
    metaRow.appendChild(badge);
    metaRow.appendChild(timeSpan);
    contentDiv.appendChild(metaRow);
    messageDiv.appendChild(contentDiv);

    chatMessages.appendChild(messageDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;

    if (options.trackInHistory !== false) {
        rememberChatTurn(sender === 'bot' ? 'assistant' : 'user', text);
    }

    return messageDiv;
}

function addTypingIndicator() {
    const indicator = document.createElement('div');
    indicator.className = 'message bot-message';
    indicator.innerHTML = `
        <div class="message-content">
            <span class="message-tag"><i class="fas fa-sparkles"></i> Health Assistant</span>
            <div class="typing-indicator">
                <span></span>
                <span></span>
                <span></span>
            </div>
        </div>
    `;
    
    chatMessages.appendChild(indicator);
    chatMessages.scrollTop = chatMessages.scrollHeight;
    
    return indicator;
}

// Share Results
const shareResultsBtn = document.getElementById('shareResultsBtn');
if (shareResultsBtn) {
    shareResultsBtn.addEventListener('click', async () => {
        if (!currentAssessmentData) return;
        
        const shareText = `My Health Assessment Results:
Overall Score: ${currentAssessmentData.overallScore}/100 (${currentAssessmentData.status})
BMI: ${currentAssessmentData.bmi}

Check your health at: ${window.location.href}`;
        
        if (navigator.share) {
            try {
                await navigator.share({
                    title: 'My Health Assessment',
                    text: shareText
                });
                trackEvent('results_shared', {
                    method: 'native_share'
                });
                showNotification('Assessment summary shared successfully.', 'success');
            } catch (error) {
                if (error.name !== 'AbortError') {
                    fallbackShare(shareText);
                }
            }
        } else {
            fallbackShare(shareText);
        }
    });
}

function fallbackShare(text) {
    navigator.clipboard.writeText(text).then(() => {
        trackEvent('results_shared', {
            method: 'clipboard'
        });
        showNotification('Assessment summary copied to the clipboard.', 'success');
    }).catch(() => {
        showNotification('Unable to share the assessment summary.', 'error');
    });
}

function showNotification(message, type = 'info') {
    const notificationStack = document.getElementById('notificationStack');
    if (!notificationStack) {
        return;
    }

    const notification = document.createElement('div');
    notification.className = `notification-toast is-${type}`;
    notification.textContent = message;
    
    notificationStack.appendChild(notification);
    
    setTimeout(() => {
        notification.classList.add('is-exiting');
        setTimeout(() => notification.remove(), 280);
    }, 3000);
}

// Add animation styles dynamically
const style = document.createElement('style');
style.textContent = `
    .notification-toast {
        animation: toastIn 0.24s ease-out;
    }

    .notification-toast.is-exiting {
        animation: toastOut 0.24s ease-out forwards;
    }

    @keyframes toastIn {
        from {
            opacity: 0;
            transform: translateY(12px);
        }
        to {
            opacity: 1;
            transform: translateY(0);
        }
    }

    @keyframes toastOut {
        from {
            opacity: 1;
            transform: translateY(0);
        }
        to {
            opacity: 0;
            transform: translateY(10px);
        }
    }
`;
document.head.appendChild(style);

function sanitizeProfileId(rawId) {
    return (rawId || '').trim().replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40);
}

// Welcome message on page load
window.addEventListener('load', () => {
    trackEvent('page_view', {
        path: window.location.pathname
    });

    resetChatConversation(false);
    initializeFormExperience();

    const savedDraft = getFormDraft();
    if (savedDraft) {
        populateHealthForm(savedDraft);
        trackEvent('form_draft_restored', {
            restoredFields: Object.keys(savedDraft).length
        });
    } else {
        updateFormProgress();
    }

    const scoreGoalInput = document.getElementById('scoreGoalInput');
    if (scoreGoalInput) {
        scoreGoalInput.value = String(getSavedScoreGoal());
    }

    const syncProfileIdInput = document.getElementById('syncProfileId');
    if (syncProfileIdInput) {
        syncProfileIdInput.value = localStorage.getItem(SYNC_PROFILE_STORAGE_KEY) || '';
    }

    renderHistorySection();
    setTimeout(() => {
        showNotification('Welcome. Start an assessment or open the assistant for guided wellness support.', 'info');
    }, 1000);
});

const historyMetricSelect = document.getElementById('historyMetricSelect');
if (historyMetricSelect) {
    historyMetricSelect.addEventListener('change', (e) => {
        selectedHistoryMetric = e.target.value;
        renderHistorySection();
    });
}

const clearHistoryBtn = document.getElementById('clearHistoryBtn');
if (clearHistoryBtn) {
    clearHistoryBtn.addEventListener('click', () => {
        localStorage.removeItem(HISTORY_STORAGE_KEY);
        if (trendChart) {
            trendChart.destroy();
            trendChart = null;
        }
        renderHistorySection();
        showNotification('Assessment history cleared.', 'success');
    });
}

const saveGoalBtn = document.getElementById('saveGoalBtn');
if (saveGoalBtn) {
    saveGoalBtn.addEventListener('click', () => {
        const scoreGoalInput = document.getElementById('scoreGoalInput');
        if (!scoreGoalInput) return;

        const goal = parseInt(scoreGoalInput.value, 10);
        if (Number.isNaN(goal) || goal < 1 || goal > 100) {
            showNotification('Target score must be between 1 and 100.', 'error');
            return;
        }

        saveScoreGoal(goal);
        renderHistorySection();
        trackEvent('goal_saved', {
            goalTarget: goal
        });
        showNotification('Goal saved.', 'success');
    });
}

const syncSaveBtn = document.getElementById('syncSaveBtn');
if (syncSaveBtn) {
    syncSaveBtn.addEventListener('click', async () => {
        const syncProfileIdInput = document.getElementById('syncProfileId');
        if (!syncProfileIdInput) return;

        const profileId = sanitizeProfileId(syncProfileIdInput.value);
        if (!profileId) {
            showNotification('Enter a valid Profile ID first.', 'error');
            return;
        }

        syncProfileIdInput.value = profileId;
        localStorage.setItem(SYNC_PROFILE_STORAGE_KEY, profileId);

        try {
            const response = await fetch('/api/history/sync', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    profileId,
                    history: getAssessmentHistory(),
                    goalTarget: getSavedScoreGoal()
                })
            });

            const payload = await response.json();
            if (!response.ok) {
                throw new Error(payload.error || 'Sync save failed');
            }

            trackEvent('history_sync_saved', {
                historyCount: getAssessmentHistory().length
            });
            showNotification('Cloud sync saved successfully.', 'success');
        } catch (error) {
            console.error('Sync save failed:', error);
            showNotification(`Cloud save failed: ${error.message}`, 'error');
        }
    });
}

const syncLoadBtn = document.getElementById('syncLoadBtn');
if (syncLoadBtn) {
    syncLoadBtn.addEventListener('click', async () => {
        const syncProfileIdInput = document.getElementById('syncProfileId');
        if (!syncProfileIdInput) return;

        const profileId = sanitizeProfileId(syncProfileIdInput.value);
        if (!profileId) {
            showNotification('Enter a valid Profile ID first.', 'error');
            return;
        }

        syncProfileIdInput.value = profileId;
        localStorage.setItem(SYNC_PROFILE_STORAGE_KEY, profileId);

        try {
            const response = await fetch(`/api/history/sync/${encodeURIComponent(profileId)}`);
            const payload = await response.json();
            if (!response.ok) {
                throw new Error(payload.error || 'Sync load failed');
            }

            localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(payload.history || []));
            if (typeof payload.goalTarget === 'number') {
                saveScoreGoal(Math.min(100, Math.max(1, Math.round(payload.goalTarget))));
            }

            renderHistorySection();
            trackEvent('history_sync_loaded', {
                historyCount: Array.isArray(payload.history) ? payload.history.length : 0
            });
            showNotification('Cloud data loaded successfully.', 'success');
        } catch (error) {
            console.error('Sync load failed:', error);
            showNotification(`Cloud load failed: ${error.message}`, 'error');
        }
    });
}
