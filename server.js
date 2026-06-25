const express = require('express');
const path = require('path');
const { createStorage } = require('./lib/storage');
const app = express();
const PORT = process.env.PORT || 3000;
const ANALYTICS_ADMIN_USERNAME = 'admin';
const MAX_CHAT_MESSAGE_LENGTH = 1000;
const MAX_ANALYTICS_PROPERTIES_LENGTH = 5000;
const ALLOWED_ANALYTICS_EVENT_NAME = /^[a-z0-9_]{1,80}$/;
const STORAGE_INIT_MAX_ATTEMPTS = 3;
const STORAGE_INIT_RETRY_DELAY_MS = 300;
const DOCTOR_SOURCE_BASE_URL = 'https://ng.aldoctorz.com/doctors/nigeria/all-specialties/';
const DOCTOR_SOURCE_MAX_LIMIT = 200;
const DOCTOR_SOURCE_MAX_PAGES = 10;
const DOCTOR_SOURCE_CACHE_TTL_MS = 10 * 60 * 1000;

let storageReady = null;
let doctorDirectoryCache = {
  doctors: [],
  fetchedAt: null,
  expiresAt: 0,
  pages: 0
};

app.disable('x-powered-by');
app.set('trust proxy', true);

function wait(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function beginStorageInitialization() {
  const pendingStorage = createStorage();

  // Clear the cached initialization promise after failures so the next request can retry.
  pendingStorage.catch(() => {
    if (storageReady === pendingStorage) {
      storageReady = null;
    }
  });

  storageReady = pendingStorage;
  return pendingStorage;
}

async function getStorage() {
  let lastError = null;

  for (let attempt = 1; attempt <= STORAGE_INIT_MAX_ATTEMPTS; attempt += 1) {
    try {
      return await (storageReady || beginStorageInitialization());
    } catch (error) {
      lastError = error;

      if (attempt < STORAGE_INIT_MAX_ATTEMPTS) {
        await wait(STORAGE_INIT_RETRY_DELAY_MS * attempt);
      }
    }
  }

  throw lastError;
}

function sanitizeProfileId(rawId) {
  return String(rawId || '')
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, '')
    .slice(0, 40);
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function decodeHtmlEntities(text) {
  return String(text || '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#039;|&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripHtml(text) {
  return decodeHtmlEntities(String(text || '').replace(/<[^>]*>/g, ' '));
}

function extractDoctorCardsFromHtml(html) {
  const doctorHeadingRegex = /<h2[^>]*>\s*<a[^>]*href="([^"]*\/dr\/[^\"]+)"[^>]*>([^<]+)<\/a>\s*<\/h2>/gi;
  const matches = [];
  let match;

  while ((match = doctorHeadingRegex.exec(html)) !== null) {
    matches.push({
      startIndex: match.index,
      profileUrl: match[1],
      name: stripHtml(match[2])
    });
  }

  if (!matches.length) {
    return [];
  }

  return matches.map((entry, index) => {
    const nextIndex = index + 1 < matches.length ? matches[index + 1].startIndex : html.length;
    const segment = html.slice(entry.startIndex, nextIndex);

    const specialtyMatch = segment.match(/Doctor\s*<a[^>]*>\s*([^<]+)\s*<\/a>/i);
    const addressMatch = segment.match(/Address\s*:\s*([^<\n]+)/i);
    const cityMatch = segment.match(/City\s*:\s*([\s\S]*?)<\/(?:h6|p)>/i);
    const cityLinks = cityMatch ? Array.from(cityMatch[1].matchAll(/<a[^>]*>([^<]+)<\/a>/gi)) : [];
    const city = cityLinks.length
      ? cityLinks.map((item) => stripHtml(item[1])).filter(Boolean).join(', ')
      : '';
    const phoneMatch = segment.match(/(\+?234[-\s]?\d(?:[-\s]?\d){8,13}|0\d{10})/);

    const normalizedProfileUrl = entry.profileUrl.startsWith('http')
      ? entry.profileUrl
      : `https://ng.aldoctorz.com${entry.profileUrl.startsWith('/') ? '' : '/'}${entry.profileUrl}`;

    return {
      name: entry.name,
      specialty: specialtyMatch ? stripHtml(specialtyMatch[1]) : 'General Practice',
      location: city || 'Nigeria',
      facility: addressMatch ? stripHtml(addressMatch[1]) : '',
      phone: phoneMatch ? stripHtml(phoneMatch[1]) : '',
      profileUrl: normalizedProfileUrl,
      source: 'Aldoctorz'
    };
  });
}

async function fetchDoctorsFromSource(limit, pages) {
  const collected = [];
  const seenProfileUrls = new Set();

  for (let page = 1; page <= pages; page += 1) {
    const pageUrl = page === 1 ? DOCTOR_SOURCE_BASE_URL : `${DOCTOR_SOURCE_BASE_URL}page/${page}/`;

    let response;
    try {
      response = await fetch(pageUrl, {
        headers: {
          'User-Agent': 'HealthAssessmentHubBot/1.0 (+https://healthassessmenthub.com)'
        }
      });
    } catch (error) {
      console.error(`Doctor source request failed for page ${page}:`, error);
      continue;
    }

    if (!response.ok) {
      console.error(`Doctor source returned ${response.status} for page ${page}`);
      continue;
    }

    const html = await response.text();
    const pageDoctors = extractDoctorCardsFromHtml(html);

    for (const doctor of pageDoctors) {
      if (!doctor.profileUrl || seenProfileUrls.has(doctor.profileUrl)) {
        continue;
      }

      seenProfileUrls.add(doctor.profileUrl);
      collected.push(doctor);

      if (collected.length >= limit) {
        return collected;
      }
    }
  }

  return collected;
}

function getAnalyticsAdminPassword() {
  return String(process.env.ANALYTICS_ADMIN_PASSWORD || '').trim();
}

function isVercelDeployment() {
  return String(process.env.VERCEL || '').trim() === '1';
}

function buildReadinessReport(storageLabel) {
  const analyticsPasswordConfigured = Boolean(getAnalyticsAdminPassword());
  const databaseUrlConfigured = Boolean(String(process.env.DATABASE_URL || '').trim());
  const vercelDeployment = isVercelDeployment();
  const checks = [
    {
      name: 'storage_initialized',
      ok: Boolean(storageLabel),
      required: true,
      detail: storageLabel ? `Storage backend: ${storageLabel}` : 'Storage backend unavailable.'
    },
    {
      name: 'analytics_admin_password',
      ok: analyticsPasswordConfigured,
      required: true,
      detail: analyticsPasswordConfigured
        ? 'Analytics admin password is configured.'
        : 'Set ANALYTICS_ADMIN_PASSWORD to protect analytics and admin endpoints.'
    },
    {
      name: 'durable_storage',
      ok: !vercelDeployment || databaseUrlConfigured,
      required: vercelDeployment,
      detail: vercelDeployment
        ? databaseUrlConfigured
          ? 'DATABASE_URL is configured for durable deployed storage.'
          : 'Set DATABASE_URL for durable storage on Vercel deployments.'
        : 'Durable cloud storage is optional outside deployed Vercel environments.'
    },
    {
      name: 'postgres_storage_in_vercel',
      ok: !vercelDeployment || storageLabel === 'postgres',
      required: vercelDeployment,
      detail: vercelDeployment
        ? storageLabel === 'postgres'
          ? 'Production storage is using Postgres as expected.'
          : `Expected postgres storage on Vercel, received ${storageLabel || 'unknown'}.`
        : 'Postgres is recommended for deployment and optional for local development.'
    }
  ];

  return {
    ready: checks.every((check) => check.ok || !check.required),
    environment: {
      node: process.version,
      nodeMajor: Number(process.versions?.node?.split?.('.')[0] || 0),
      vercel: vercelDeployment,
      nodeEnv: String(process.env.NODE_ENV || 'development')
    },
    checks
  };
}

async function getHealthPayload() {
  const storage = await getStorage();
  const storageLabel = storage.label || 'unknown';
  const readiness = buildReadinessReport(storageLabel);

  return {
    ok: true,
    storage: storageLabel,
    timestamp: new Date().toISOString(),
    readiness
  };
}

function sendAnalyticsAuthResponse(req, res, statusCode, message) {
  if (String(req.originalUrl || '').startsWith('/api/')) {
    return res.status(statusCode).json({ error: message });
  }

  return res.status(statusCode).send(message);
}

function requireAnalyticsAuth(req, res, next) {
  const configuredPassword = getAnalyticsAdminPassword();

  if (!configuredPassword) {
    return sendAnalyticsAuthResponse(
      req,
      res,
      503,
      'Analytics dashboard is not configured. Set ANALYTICS_ADMIN_PASSWORD first.'
    );
  }

  const authorization = String(req.headers.authorization || '');
  if (!authorization.startsWith('Basic ')) {
    res.set('WWW-Authenticate', 'Basic realm="Analytics Dashboard"');
    return sendAnalyticsAuthResponse(req, res, 401, 'Analytics dashboard authentication required.');
  }

  let decodedCredentials = '';
  try {
    decodedCredentials = Buffer.from(authorization.slice(6), 'base64').toString('utf8');
  } catch {
    res.set('WWW-Authenticate', 'Basic realm="Analytics Dashboard"');
    return sendAnalyticsAuthResponse(req, res, 401, 'Invalid analytics dashboard credentials.');
  }

  const separatorIndex = decodedCredentials.indexOf(':');
  const username = separatorIndex >= 0 ? decodedCredentials.slice(0, separatorIndex) : '';
  const password = separatorIndex >= 0 ? decodedCredentials.slice(separatorIndex + 1) : '';

  if (username !== ANALYTICS_ADMIN_USERNAME || password !== configuredPassword) {
    res.set('WWW-Authenticate', 'Basic realm="Analytics Dashboard"');
    return sendAnalyticsAuthResponse(req, res, 401, 'Invalid analytics dashboard credentials.');
  }

  return next();
}

app.use(express.json({ limit: '5mb' }));
app.use((req, res, next) => {
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  next();
});
app.use(
  ['/analytics', '/analytics.html', '/api/analytics/summary', '/api/admin/export', '/api/admin/restore'],
  requireAnalyticsAuth
);

app.get('/analytics', (req, res) => {
  res.redirect('/analytics.html');
});

app.get('/analytics.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'analytics.html'));
});

app.get('/favicon.ico', (req, res) => {
  res.type('image/svg+xml');
  res.sendFile(path.join(__dirname, 'public', 'favicon.svg'));
});

app.use(express.static('public'));

app.get('/api/health', async (req, res) => {
  try {
    return res.json(await getHealthPayload());
  } catch (error) {
    console.error('Health check error:', error);
    return res.status(500).json({ ok: false, error: 'Storage initialization failed' });
  }
});

app.get('/api/readiness', async (req, res) => {
  try {
    const payload = await getHealthPayload();
    return res.status(payload.readiness.ready ? 200 : 503).json(payload);
  } catch (error) {
    console.error('Readiness check error:', error);
    return res.status(503).json({
      ok: false,
      ready: false,
      error: 'Storage initialization failed',
      readiness: {
        ready: false,
        environment: {
          node: process.version,
          nodeMajor: Number(process.versions?.node?.split?.('.')[0] || 0),
          vercel: isVercelDeployment(),
          nodeEnv: String(process.env.NODE_ENV || 'development')
        },
        checks: [
          {
            name: 'storage_initialized',
            ok: false,
            required: true,
            detail: 'Storage initialization failed.'
          }
        ]
      }
    });
  }
});

function normalizeHistoryEntry(entry) {
  return {
    id: String(entry.id || ''),
    createdAt: String(entry.createdAt || ''),
    overallScore: Number(entry.overallScore || 0),
    status: String(entry.status || ''),
    bmi: Number(entry.bmi || 0),
    age: Number(entry.age || 0),
    systolic: Number(entry.systolic || 0),
    diastolic: Number(entry.diastolic || 0),
    heartRate: Number(entry.heartRate || 0),
    exerciseHours: Number(entry.exerciseHours || 0),
    sleepHours: Number(entry.sleepHours || 0),
    stressLevel: Number(entry.stressLevel || 0)
  };
}

function normalizeGoalTarget(goalTarget) {
  return Math.min(100, Math.max(1, Number(goalTarget || 85)));
}


async function saveSyncedProfile(profileId, history, goalTarget) {
  const storage = await getStorage();
  return storage.saveSyncedProfile(profileId, history, goalTarget);
}

async function getSyncedProfile(profileId) {
  const storage = await getStorage();
  return storage.getSyncedProfile(profileId);
}

async function saveAnalyticsEvent(sessionId, eventName, properties) {
  const storage = await getStorage();
  return storage.saveAnalyticsEvent(sessionId, eventName, properties);
}

async function getAnalyticsSummary() {
  const storage = await getStorage();
  return storage.getAnalyticsSummary();
}

async function exportAdminData() {
  const storage = await getStorage();
  return storage.exportAdminData();
}

async function restoreAdminData(payload) {
  const storage = await getStorage();
  return storage.restoreAdminData(payload);
}

// Health assessment scoring engine
class HealthAssessmentAI {
  constructor() {
    // Weight factors for different health metrics
    this.weights = {
      age: 0.15,
      bmi: 0.25,
      bloodPressure: 0.20,
      heartRate: 0.15,
      exercise: 0.10,
      sleep: 0.10,
      stress: 0.05
    };
  }

  calculateBMI(weight, height) {
    // weight in kg, height in cm
    const heightInMeters = height / 100;
    return weight / (heightInMeters * heightInMeters);
  }

  scoreBMI(bmi) {
    if (bmi < 18.5) return 60; // Underweight
    if (bmi >= 18.5 && bmi < 25) return 100; // Normal
    if (bmi >= 25 && bmi < 30) return 70; // Overweight
    if (bmi >= 30 && bmi < 35) return 50; // Obese
    return 30; // Severely obese
  }

  scoreAge(age) {
    if (age < 30) return 100;
    if (age < 50) return 90;
    if (age < 65) return 75;
    return 60;
  }

  scoreBloodPressure(systolic, diastolic) {
    if (systolic < 120 && diastolic < 80) return 100; // Normal
    if (systolic < 130 && diastolic < 85) return 85; // Elevated
    if (systolic < 140 && diastolic < 90) return 70; // Stage 1 hypertension
    if (systolic < 180 && diastolic < 120) return 40; // Stage 2 hypertension
    return 20; // Hypertensive crisis
  }

  scoreHeartRate(heartRate, age) {
    const maxHeartRate = 220 - age;
    const restingOptimal = 60;
    const restingMax = 100;
    
    if (heartRate >= restingOptimal && heartRate <= restingMax) return 100;
    if (heartRate < restingOptimal) return 90;
    if (heartRate > restingMax && heartRate <= maxHeartRate * 0.6) return 70;
    return 50;
  }

  scoreExercise(hoursPerWeek) {
    if (hoursPerWeek >= 5) return 100;
    if (hoursPerWeek >= 3) return 85;
    if (hoursPerWeek >= 1) return 60;
    return 30;
  }

  scoreSleep(hoursPerNight) {
    if (hoursPerNight >= 7 && hoursPerNight <= 9) return 100;
    if ((hoursPerNight >= 6 && hoursPerNight < 7) || (hoursPerNight > 9 && hoursPerNight <= 10)) return 80;
    return 50;
  }

  scoreStress(stressLevel) {
    // stressLevel: 1 (low) to 5 (high)
    return 100 - (stressLevel - 1) * 20;
  }

  assessHealth(data) {
    const bmi = this.calculateBMI(data.weight, data.height);
    
    const scores = {
      age: this.scoreAge(data.age),
      bmi: this.scoreBMI(bmi),
      bloodPressure: this.scoreBloodPressure(data.systolic, data.diastolic),
      heartRate: this.scoreHeartRate(data.heartRate, data.age),
      exercise: this.scoreExercise(data.exerciseHours),
      sleep: this.scoreSleep(data.sleepHours),
      stress: this.scoreStress(data.stressLevel)
    };

    // Calculate weighted overall score
    let overallScore = 0;
    for (const [metric, score] of Object.entries(scores)) {
      overallScore += score * this.weights[metric];
    }

    // Generate health status and recommendations
    let status, recommendations;
    if (overallScore >= 85) {
      status = 'Excellent';
      recommendations = [
        'Your health metrics are excellent! Keep up the good work.',
        'Continue your current lifestyle and health habits.',
        'Schedule regular check-ups to maintain your health.'
      ];
    } else if (overallScore >= 70) {
      status = 'Good';
      recommendations = [
        'Your overall health is good, but there\'s room for improvement.',
        'Focus on areas with lower scores to optimize your health.',
        'Consider consulting a healthcare provider for personalized advice.'
      ];
    } else if (overallScore >= 50) {
      status = 'Fair';
      recommendations = [
        'Your health needs attention in several areas.',
        'Increase physical activity to at least 3 hours per week.',
        'Aim for 7-9 hours of sleep each night.',
        'Consider stress management techniques like meditation or yoga.',
        'Consult with a healthcare provider for a comprehensive health plan.'
      ];
    } else {
      status = 'Needs Improvement';
      recommendations = [
        'Your health requires immediate attention.',
        'Please consult with a healthcare provider as soon as possible.',
        'Start with small lifestyle changes: more exercise, better sleep, healthier diet.',
        'Monitor your blood pressure and heart rate regularly.',
        'Consider joining support groups or health programs.'
      ];
    }

    return {
      overallScore: Math.round(overallScore),
      status,
      bmi: Math.round(bmi * 10) / 10,
      detailedScores: scores,
      recommendations
    };
  }
}

const healthAI = new HealthAssessmentAI();

// Rule-based health chat assistant
class HealthChatAgent {
  constructor() {
    this.metricLabels = {
      age: 'Age profile',
      bmi: 'Weight balance',
      bloodPressure: 'Blood pressure',
      heartRate: 'Heart rate',
      exercise: 'Exercise consistency',
      sleep: 'Sleep quality',
      stress: 'Stress management'
    };
    this.metricAdvice = {
      age: 'Age cannot be changed, so the best leverage usually comes from strengthening the lifestyle metrics around it.',
      bmi: 'Focus on sustainable nutrition, regular movement, and slow habit changes rather than aggressive dieting.',
      bloodPressure: 'Reduce sodium, stay active, prioritize sleep, and monitor readings consistently.',
      heartRate: 'A steadier exercise routine, better sleep, and reduced stimulant load often help over time.',
      exercise: 'Increase activity gradually until movement is a normal part of most days each week.',
      sleep: 'Protect a consistent sleep schedule and reduce late-night stimulation.',
      stress: 'Build a repeatable stress-down routine instead of waiting until stress feels overwhelming.'
    };
  }

  generateReply(userMessage, healthContext, conversationHistory = []) {
    const message = String(userMessage || '').toLowerCase();
    const safeHistory = Array.isArray(conversationHistory)
      ? conversationHistory.filter(isPlainObject).slice(-8)
      : [];
    const intent = this.detectIntent(message, healthContext, safeHistory);

    switch (intent) {
      case 'greeting':
        return {
          response:
            "Hello. I can explain your assessment, point out the weakest metric, build a realistic plan, or help you decide when professional follow-up makes sense.",
          followUpPrompts: [
            'Summarize my latest assessment in simple language',
            'Which metric is holding my score back the most?',
            'Create a 7-day improvement plan'
          ]
        };
      case 'capabilities':
        return {
          response:
            "Here is what I can help with:\n\n1. Explain your overall score and what is driving it.\n2. Highlight the top priority metric to work on first.\n3. Turn your results into a simple daily or weekly routine.\n4. Give targeted guidance on sleep, exercise, stress, weight, heart rate, or blood pressure.\n5. Suggest when it is wise to involve a healthcare professional.",
          followUpPrompts: [
            'Summarize my latest assessment in simple language',
            'Turn my results into a daily routine',
            'When should I talk to a doctor about these results?'
          ]
        };
      case 'summary':
        return this.summarizeAssessment(healthContext);
      case 'priority':
        return this.explainPriorityMetric(healthContext);
      case 'plan':
        return this.buildActionPlan(healthContext, safeHistory);
      case 'doctor':
        return this.discussDoctorSupport(healthContext);
      case 'bmi':
        return this.explainBMI(healthContext);
      case 'bloodPressure':
        return this.explainBloodPressure(healthContext);
      case 'exercise':
        return this.adviceExercise(healthContext);
      case 'sleep':
        return this.adviceSleep(healthContext);
      case 'stress':
        return this.adviceStress(healthContext);
      case 'diet':
        return this.adviceNutrition(healthContext);
      case 'heart':
        return this.explainHeartRate(healthContext);
      default:
        return this.defaultResponse(healthContext, safeHistory);
    }
  }

  detectIntent(message, healthContext, conversationHistory) {
    const previousTopic = this.extractRecentTopic(conversationHistory);
    const hasContext = Boolean(healthContext && healthContext.overallScore);

    if (message.includes('hello') || message.includes('hi')) return 'greeting';
    if (message.includes('what can you do') || message.includes('help')) return 'capabilities';
    if (
      hasContext &&
      (message.includes('summarize') ||
        message.includes('simple language') ||
        message.includes('latest assessment') ||
        message.includes('understand my results'))
    ) {
      return 'summary';
    }
    if (
      hasContext &&
      (message.includes('holding my score back') ||
        message.includes('improve first') ||
        message.includes('priority') ||
        message.includes('focus first') ||
        message.includes('weakest'))
    ) {
      return 'priority';
    }
    if (
      hasContext &&
      (message.includes('7-day') ||
        message.includes('plan') ||
        message.includes('routine') ||
        message.includes('daily') ||
        message.includes('weekly') ||
        message.includes('maintain this score') ||
        message.includes('next month'))
    ) {
      return 'plan';
    }
    if (
      hasContext &&
      (message.includes('doctor') ||
        message.includes('healthcare professional') ||
        message.includes('clinical') ||
        message.includes('when should i talk'))
    ) {
      return 'doctor';
    }
    if (message.includes('score') || message.includes('result')) return hasContext ? 'summary' : 'capabilities';
    if (message.includes('bmi') || message.includes('weight')) return 'bmi';
    if (message.includes('blood pressure') || message.includes('bp')) return 'bloodPressure';
    if (message.includes('sleep') || previousTopic === 'sleep') return 'sleep';
    if (message.includes('stress') || previousTopic === 'stress') return 'stress';
    if (message.includes('exercise') || message.includes('workout') || message.includes('cardio')) return 'exercise';
    if (message.includes('diet') || message.includes('food') || message.includes('eat') || message.includes('nutrition')) return 'diet';
    if (message.includes('heart') || message.includes('cardiovascular') || message.includes('heart rate')) return 'heart';

    return hasContext ? 'summary' : 'default';
  }

  extractRecentTopic(conversationHistory) {
    const recentText = conversationHistory
      .map((entry) => String(entry.content || '').toLowerCase())
      .join(' ');

    if (recentText.includes('sleep')) return 'sleep';
    if (recentText.includes('stress')) return 'stress';
    if (recentText.includes('exercise') || recentText.includes('workout')) return 'exercise';
    if (recentText.includes('blood pressure') || recentText.includes('bp')) return 'bloodPressure';
    if (recentText.includes('heart')) return 'heart';
    return '';
  }

  getLowestMetrics(context, count = 3) {
    return Object.entries(context?.detailedScores || {})
      .sort((a, b) => a[1] - b[1])
      .slice(0, count);
  }

  getStrongestMetric(context) {
    const scored = Object.entries(context?.detailedScores || {}).sort((a, b) => b[1] - a[1]);
    return scored[0] || null;
  }

  getMetricLabel(metricKey) {
    return this.metricLabels[metricKey] || metricKey;
  }

  shouldEncourageClinicalSupport(context) {
    if (!context) {
      return false;
    }

    return (
      Number(context.overallScore || 0) < 50 ||
      Number(context.systolic || 0) >= 140 ||
      Number(context.diastolic || 0) >= 90 ||
      Number(context.heartRate || 0) >= 95
    );
  }

  summarizeAssessment(context) {
    if (!context || !context.overallScore) {
      return this.defaultResponse();
    }

    const weakestMetric = this.getLowestMetrics(context, 1)[0];
    const strongestMetric = this.getStrongestMetric(context);
    const score = Number(context.overallScore || 0);
    const summary = [
      `Your latest score is ${score}/100 and the overall rating is ${context.status}.`,
      weakestMetric
        ? `The clearest area to work on first is ${this.getMetricLabel(weakestMetric[0]).toLowerCase()}.`
        : 'Your detailed metric breakdown is not available yet.',
      strongestMetric
        ? `One of your stronger signals right now is ${this.getMetricLabel(strongestMetric[0]).toLowerCase()}.`
        : ''
    ].filter(Boolean);

    if (this.shouldEncourageClinicalSupport(context)) {
      summary.push('Because at least one signal looks more strained, professional follow-up would be a sensible safety step.');
    } else {
      summary.push('This looks like a changeable profile, so consistent habit work should matter more than perfection.');
    }

    return {
      response: `Here is the plain-language read:\n\n${summary.join('\n\n')}`,
      followUpPrompts: [
        'Which metric is holding my score back the most?',
        'Create a 7-day improvement plan',
        'Turn my results into a daily routine'
      ]
    };
  }

  explainPriorityMetric(context) {
    if (!context || !context.overallScore) {
      return this.defaultResponse();
    }

    const lowestScores = this.getLowestMetrics(context, 3);
    const [topPriority] = lowestScores;

    if (!topPriority) {
      return this.summarizeAssessment(context);
    }

    const lines = [
      `The top priority is ${this.getMetricLabel(topPriority[0])} at roughly ${Math.round(topPriority[1])}/100.`,
      this.metricAdvice[topPriority[0]] || 'This is the clearest place to start improving first.',
      'A good rule is to work on the weakest metric first, then support it with one adjacent habit so the change sticks better.'
    ];

    if (lowestScores[1]) {
      lines.push(
        `Right behind it is ${this.getMetricLabel(lowestScores[1][0]).toLowerCase()}, so those two areas likely reinforce each other.`
      );
    }

    return {
      response: `Here is where I would focus first:\n\n${lines.join('\n\n')}`,
      followUpPrompts: [
        `How do I improve my ${this.getMetricLabel(topPriority[0]).toLowerCase()}?`,
        'Create a 7-day improvement plan',
        'When should I talk to a doctor about these results?'
      ]
    };
  }

  buildActionPlan(context, conversationHistory) {
    if (!context || !context.overallScore) {
      return {
        response:
          'I can build a much better plan once you complete an assessment. After that, I can turn your score and weakest metrics into a daily or weekly routine.',
        followUpPrompts: [
          'Explain what a strong health score usually indicates',
          'How much exercise should I aim for this week?',
          'What does healthy sleep typically look like?'
        ]
      };
    }

    const score = Number(context.overallScore || 0);
    const weakestMetrics = this.getLowestMetrics(context, 2);
    const focusMetric = weakestMetrics[0]?.[0];
    const planTitle =
      score >= 85
        ? '7-day maintenance plan'
        : score >= 70
          ? '7-day strengthening plan'
          : score >= 50
            ? '7-day recovery plan'
            : '7-day priority support plan';

    const dayPlan = [
      'Day 1: Review your weakest metric and set one realistic target for the week.',
      focusMetric === 'sleep'
        ? 'Day 2: Lock in a consistent bedtime and wake time for the next 7 days.'
        : focusMetric === 'exercise'
          ? 'Day 2: Schedule two short movement blocks you know you can actually complete.'
          : focusMetric === 'stress'
            ? 'Day 2: Add one repeatable 5-10 minute stress reset to your day.'
            : 'Day 2: Make the easiest healthy change you can repeat tomorrow.',
      'Day 3: Reduce one obvious friction point such as poor timing, skipped meals, or an unrealistic routine.',
      'Day 4: Repeat the plan even if motivation is low. Consistency matters more than intensity here.',
      'Day 5: Check your sleep, stress, and movement together rather than treating them as separate issues.',
      'Day 6: Notice what felt sustainable and keep that piece.',
      'Day 7: Review the week and choose the one habit to carry into the next 7 days.'
    ];

    if (this.shouldEncourageClinicalSupport(context)) {
      dayPlan.push('Safety step: If readings stay elevated or symptoms concern you, discuss them with a healthcare professional promptly.');
    }

    if (conversationHistory.some((entry) => String(entry.content || '').toLowerCase().includes('daily routine'))) {
      dayPlan[0] = 'Day 1: Build your routine around the same wake time, meals, movement window, and bedtime.';
    }

    return {
      response: `${planTitle}:\n\n${dayPlan.map((item, index) => `${index + 1}. ${item}`).join('\n')}`,
      followUpPrompts: [
        'Turn this into a simpler daily checklist',
        'Which metric should I measure again first?',
        'How do I keep this plan realistic?'
      ]
    };
  }

  discussDoctorSupport(context) {
    if (!context || !context.overallScore) {
      return {
        response:
          'A clinician is especially useful when symptoms are new, readings stay abnormal, or your daily function is being affected. If you share your assessment results after checking in, I can help you frame the conversation more clearly.',
        followUpPrompts: [
          'What numbers should I keep an eye on?',
          'What should I ask during a health appointment?',
          'Summarize my latest assessment in simple language'
        ]
      };
    }

    const reasons = [];

    if (Number(context.overallScore || 0) < 50) {
      reasons.push('your overall score is in the needs-improvement range');
    }
    if (Number(context.systolic || 0) >= 140 || Number(context.diastolic || 0) >= 90) {
      reasons.push(`your blood pressure reading is ${context.systolic}/${context.diastolic}`);
    }
    if (Number(context.heartRate || 0) >= 95) {
      reasons.push(`your resting heart rate is ${context.heartRate} bpm`);
    }

    const recommendation = reasons.length
      ? `Professional follow-up would be reasonable because ${reasons.join(', ')}.`
      : 'Professional follow-up is optional here, but still useful if you want tailored advice or your symptoms do not match the score.';

    return {
      response:
        `${recommendation}\n\nIf you book a visit, bring these points:\n\n1. Your latest score and status.\n2. Any home readings that are repeatedly elevated.\n3. Symptoms, timing, and how daily life is being affected.\n4. The one or two habits you have already tried to change.`,
      followUpPrompts: [
        'What should I ask during a health appointment?',
        'Which metric is holding my score back the most?',
        'Create a 7-day improvement plan'
      ]
    };
  }

  explainBMI(context) {
    if (!context || typeof context.bmi !== 'number') {
      return this.defaultResponse();
    }

    const bmi = context.bmi;
    let category;
    let advice;

    if (bmi < 18.5) {
      category = 'underweight';
      advice = 'Aim for nutrient-dense meals, regular strength work, and professional guidance if weight loss was unintentional.';
    } else if (bmi < 25) {
      category = 'a generally healthy range';
      advice = 'The main goal is protecting this range with consistent eating, movement, and sleep habits.';
    } else if (bmi < 30) {
      category = 'overweight';
      advice = 'A modest reduction in weight can help blood pressure, heart health, and overall score at the same time.';
    } else {
      category = 'obese';
      advice = 'This is a high-leverage area to improve, but the safest progress usually comes from steady changes rather than aggressive restriction.';
    }

    return {
      response:
        `Your BMI is ${bmi}, which sits in the ${category} category.\n\nWhat matters most is not chasing a perfect number, but improving the surrounding habits that influence energy, blood pressure, and long-term risk.\n\nBest next step: ${advice}`,
      followUpPrompts: [
        'Give me a simple nutrition plan',
        'Create a weekly exercise plan',
        'Which metric is holding my score back the most?'
      ]
    };
  }

  explainBloodPressure(context) {
    if (!context) {
      return this.defaultResponse();
    }

    const systolic = Number(context.systolic || 0);
    const diastolic = Number(context.diastolic || 0);
    let interpretation;

    if (systolic < 120 && diastolic < 80) {
      interpretation = 'This is in a healthy range for many adults.';
    } else if (systolic < 130 && diastolic < 85) {
      interpretation = 'This is slightly elevated and worth monitoring over time.';
    } else if (systolic < 140 && diastolic < 90) {
      interpretation = 'This suggests a mild elevation, so lifestyle consistency matters a lot here.';
    } else {
      interpretation = 'This is elevated enough that clinical follow-up would be a sensible next step.';
    }

    return {
      response:
        `Your blood pressure reading is ${systolic}/${diastolic} mmHg.\n\n${interpretation}\n\nThe biggest habit levers are:\n\n1. Lowering sodium and ultra-processed foods.\n2. Staying active most days of the week.\n3. Protecting sleep and recovery.\n4. Rechecking readings consistently rather than relying on a single measurement.`,
      followUpPrompts: [
        'Which foods support healthy blood pressure?',
        'When should I talk to a doctor about these results?',
        'Create a 7-day improvement plan'
      ]
    };
  }

  explainHeartRate(context) {
    if (!context) {
      return this.defaultResponse();
    }

    const heartRate = Number(context.heartRate || 0);
    let interpretation;

    if (heartRate <= 70) {
      interpretation = 'That is often a reassuring resting value, especially if you feel well.';
    } else if (heartRate <= 85) {
      interpretation = 'That is a workable range, though better recovery and conditioning may still help.';
    } else {
      interpretation = 'That is high enough to pay attention to, especially if it stays elevated or symptoms are present.';
    }

    return {
      response:
        `Your resting heart rate is ${heartRate} bpm.\n\n${interpretation}\n\nWhat often helps most:\n\n1. More consistent aerobic conditioning.\n2. Better sleep and hydration.\n3. Lower stimulant load if relevant.\n4. Stress reduction that you can repeat daily.`,
      followUpPrompts: [
        'How much cardio do I need?',
        'Give me a 5-minute stress reset',
        'Create a weekly exercise plan'
      ]
    };
  }

  adviceExercise(context) {
    if (!context) {
      return this.defaultResponse();
    }

    const exerciseHours = Number(context.exerciseHours || 0);
    let opening;

    if (exerciseHours >= 5) {
      opening = 'You are already building a strong movement base.';
    } else if (exerciseHours >= 3) {
      opening = 'You are in a decent range, but a little more consistency could move other metrics too.';
    } else if (exerciseHours >= 1) {
      opening = 'You have a starting point, which is more important than perfection.';
    } else {
      opening = 'This looks like the easiest high-impact area to improve first.';
    }

    return {
      response:
        `You are currently logging about ${exerciseHours} hours of exercise per week.\n\n${opening}\n\nA realistic target:\n\n1. Aim for 150 minutes of moderate activity across the week.\n2. Add 2 short strength sessions if possible.\n3. Keep the first version small enough that you can repeat it next week.`,
      followUpPrompts: [
        'Build me a beginner weekly exercise plan',
        'What if I only have 20 minutes a day?',
        'Turn my results into a daily routine'
      ]
    };
  }

  adviceSleep(context) {
    if (!context) {
      return this.defaultResponse();
    }

    const sleepHours = Number(context.sleepHours || 0);
    let interpretation;

    if (sleepHours >= 7 && sleepHours <= 9) {
      interpretation = 'That is within the usual recovery sweet spot for many adults.';
    } else if (sleepHours < 7) {
      interpretation = 'This is below the usual recovery target, so sleep may be dragging other metrics down too.';
    } else {
      interpretation = 'This is above the usual target range, so sleep quality and daytime energy are worth noticing too.';
    }

    return {
      response:
        `You are averaging about ${sleepHours} hours of sleep per night.\n\n${interpretation}\n\nThe highest-value sleep moves are:\n\n1. Keep the same wake time most days.\n2. Reduce screens and stimulation before bed.\n3. Avoid heavy meals or caffeine too late.\n4. Treat sleep as a schedule, not an afterthought.`,
      followUpPrompts: [
        'What bedtime habits help most?',
        'How many hours should I target each night?',
        'Create a 7-day improvement plan'
      ]
    };
  }

  adviceStress(context) {
    if (!context) {
      return this.defaultResponse();
    }

    const stressLevel = Number(context.stressLevel || 0);
    let interpretation;

    if (stressLevel <= 2) {
      interpretation = 'Stress looks reasonably controlled right now.';
    } else if (stressLevel === 3) {
      interpretation = 'Stress is present but still looks workable if you build a repeatable reset habit.';
    } else {
      interpretation = 'Stress is likely affecting both recovery and decision-making, so it deserves direct attention.';
    }

    return {
      response:
        `Your reported stress level is ${stressLevel}/5.\n\n${interpretation}\n\nA practical reset stack:\n\n1. One short breathing or walking break during the day.\n2. One clear work-stop time in the evening.\n3. One calming routine before bed.\n4. One person or place you use for support instead of pushing through alone.`,
      followUpPrompts: [
        'Give me a 5-minute stress reset',
        'How can I lower stress during work?',
        'What are signs my stress is too high?'
      ]
    };
  }

  adviceNutrition(context) {
    const hasContext = Boolean(context && context.overallScore);
    const weakestMetric = hasContext ? this.getLowestMetrics(context, 1)[0] : null;
    const nutritionAngle =
      weakestMetric?.[0] === 'bloodPressure'
        ? 'Focus especially on sodium reduction, potassium-rich foods, and fewer heavily processed meals.'
        : weakestMetric?.[0] === 'bmi'
          ? 'Focus on meal consistency, protein, fiber, and portions you can sustain without extremes.'
          : 'Focus on a simple plate pattern: protein, produce, whole-food carbohydrates, and hydration.';

    return {
      response:
        `A strong nutrition baseline does not need to be complicated.\n\n1. Eat more minimally processed foods most days.\n2. Build meals around protein and produce first.\n3. Keep sugary drinks and high-sodium convenience foods occasional.\n4. Use consistency more than restriction.\n\n${nutritionAngle}`,
      followUpPrompts: [
        'Give me a simple daily meal structure',
        'Which foods support healthy blood pressure?',
        'Create a 7-day improvement plan'
      ]
    };
  }

  defaultResponse(context) {
    if (context && context.overallScore) {
      return {
        response:
          'I can help most with your latest assessment. Ask me to summarize it, identify the weakest metric, build a 7-day plan, or explain one specific area like sleep, stress, blood pressure, exercise, or weight.',
        followUpPrompts: [
          'Summarize my latest assessment in simple language',
          'Which metric is holding my score back the most?',
          'Create a 7-day improvement plan'
        ]
      };
    }

    return {
      response:
        'I can explain health basics, but the assistant becomes much more useful after an assessment because it can personalize the advice. In the meantime, ask about sleep, exercise, stress, nutrition, or how the scoring works.',
      followUpPrompts: [
        'Explain what a strong health score usually indicates',
        'How much exercise should I aim for this week?',
        'What does healthy sleep typically look like?'
      ]
    };
  }
}

const chatAgent = new HealthChatAgent();

// API endpoint for AI chat
app.post('/api/chat', (req, res) => {
  try {
    const { message, context, history } = req.body || {};
    const trimmedMessage = String(message || '').trim();

    if (!trimmedMessage) {
      return res.status(400).json({ error: 'Message is required' });
    }

    if (trimmedMessage.length > MAX_CHAT_MESSAGE_LENGTH) {
      return res.status(400).json({ error: 'Message cannot exceed 1000 characters' });
    }

    const safeContext = isPlainObject(context) ? context : {};
    const safeHistory = Array.isArray(history)
      ? history
          .filter(isPlainObject)
          .map((entry) => ({
            role: String(entry.role || '').slice(0, 40),
            content: String(entry.content || '').slice(0, MAX_CHAT_MESSAGE_LENGTH)
          }))
          .filter((entry) => entry.role && entry.content)
          .slice(-8)
      : [];
    const reply = chatAgent.generateReply(trimmedMessage, safeContext, safeHistory);

    res.json(reply);
  } catch (error) {
    console.error('Chat error:', error);
    res.status(500).json({ 
      error: 'An error occurred while processing your message' 
    });
  }
});

app.get('/api/doctors/nigeria', async (req, res) => {
  try {
    const rawLimit = Number(req.query.limit || 30);
    const rawPages = Number(req.query.pages || 3);
    const forceRefresh = String(req.query.refresh || '').toLowerCase() === 'true';
    const limit = Math.min(DOCTOR_SOURCE_MAX_LIMIT, Math.max(1, Number.isFinite(rawLimit) ? Math.floor(rawLimit) : 30));
    const pages = Math.min(DOCTOR_SOURCE_MAX_PAGES, Math.max(1, Number.isFinite(rawPages) ? Math.floor(rawPages) : 3));
    const now = Date.now();

    const cacheIsFresh = now < doctorDirectoryCache.expiresAt;
    const cacheMatchesRequest = doctorDirectoryCache.pages >= pages && doctorDirectoryCache.doctors.length >= limit;

    if (!forceRefresh && cacheIsFresh && cacheMatchesRequest) {
      return res.json({
        source: DOCTOR_SOURCE_BASE_URL,
        fetchedAt: doctorDirectoryCache.fetchedAt,
        total: limit,
        doctors: doctorDirectoryCache.doctors.slice(0, limit),
        cached: true,
        stale: false
      });
    }

    const doctors = await fetchDoctorsFromSource(limit, pages);

    if (doctors.length) {
      doctorDirectoryCache = {
        doctors,
        fetchedAt: new Date().toISOString(),
        expiresAt: now + DOCTOR_SOURCE_CACHE_TTL_MS,
        pages
      };

      return res.json({
        source: DOCTOR_SOURCE_BASE_URL,
        fetchedAt: doctorDirectoryCache.fetchedAt,
        total: doctors.length,
        doctors,
        cached: false,
        stale: false
      });
    }

    if (doctorDirectoryCache.doctors.length) {
      return res.json({
        source: DOCTOR_SOURCE_BASE_URL,
        fetchedAt: doctorDirectoryCache.fetchedAt,
        total: Math.min(limit, doctorDirectoryCache.doctors.length),
        doctors: doctorDirectoryCache.doctors.slice(0, limit),
        cached: true,
        stale: true
      });
    }

    return res.json({
      source: DOCTOR_SOURCE_BASE_URL,
      fetchedAt: new Date().toISOString(),
      total: doctors.length,
      doctors,
      cached: false,
      stale: false
    });
  } catch (error) {
    console.error('Doctor directory fetch error:', error);
    return res.status(500).json({ error: 'Unable to load doctor directory from source' });
  }
});

// API endpoint for health assessment
app.post('/api/assess', (req, res) => {
  try {
    const healthData = req.body;
    
    // Validate required fields and types
    const validationRules = {
      age: { min: 1, max: 120, type: 'number' },
      weight: { min: 20, max: 300, type: 'number' },
      height: { min: 100, max: 250, type: 'number' },
      systolic: { min: 70, max: 200, type: 'number' },
      diastolic: { min: 40, max: 130, type: 'number' },
      heartRate: { min: 40, max: 200, type: 'number' },
      exerciseHours: { min: 0, max: 40, type: 'number' },
      sleepHours: { min: 0, max: 24, type: 'number' },
      stressLevel: { min: 1, max: 5, type: 'number' }
    };
    
    for (const [field, rules] of Object.entries(validationRules)) {
      const value = healthData[field];
      
      // Check if field exists
      if (value === undefined || value === null) {
        return res.status(400).json({ 
          error: `Missing required field: ${field}` 
        });
      }
      
      // Check if field is a number
      if (typeof value !== 'number' || isNaN(value)) {
        return res.status(400).json({ 
          error: `Field ${field} must be a valid number` 
        });
      }
      
      // Check if value is within acceptable range
      if (value < rules.min || value > rules.max) {
        return res.status(400).json({ 
          error: `Field ${field} must be between ${rules.min} and ${rules.max}` 
        });
      }
    }

    const assessment = healthAI.assessHealth(healthData);
    res.json(assessment);
  } catch (error) {
    console.error('Assessment error:', error);
    res.status(500).json({ 
      error: 'An error occurred during health assessment' 
    });
  }
});

app.post('/api/history/sync', async (req, res) => {
  try {
    const { profileId: rawProfileId, history, goalTarget } = req.body || {};
    const profileId = sanitizeProfileId(rawProfileId);

    if (!profileId) {
      return res.status(400).json({ error: 'Valid profileId is required' });
    }

    if (!Array.isArray(history)) {
      return res.status(400).json({ error: 'history must be an array' });
    }

    if (history.length > 500) {
      return res.status(400).json({ error: 'history cannot exceed 500 entries' });
    }

    if (!history.every(isPlainObject)) {
      return res.status(400).json({ error: 'Each history entry must be an object' });
    }

    const normalizedHistory = history.map(normalizeHistoryEntry);
    const updatedAt = await saveSyncedProfile(profileId, normalizedHistory, goalTarget);
    return res.json({
      ok: true,
      updatedAt,
      records: normalizedHistory.length
    });
  } catch (error) {
    console.error('History sync save error:', error);
    return res.status(500).json({ error: 'Unable to save sync data' });
  }
});

app.get('/api/history/sync/:profileId', async (req, res) => {
  try {
    const profileId = sanitizeProfileId(req.params.profileId);

    if (!profileId) {
      return res.status(400).json({ error: 'Valid profileId is required' });
    }

    const data = await getSyncedProfile(profileId);

    if (!data) {
      return res.status(404).json({ error: 'No synced data found for this profileId' });
    }

    return res.json({
      history: Array.isArray(data.history) ? data.history : [],
      goalTarget: Number(data.goalTarget || 85),
      updatedAt: data.updatedAt || null
    });
  } catch (error) {
    console.error('History sync load error:', error);
    return res.status(500).json({ error: 'Unable to load sync data' });
  }
});

app.post('/api/analytics/event', async (req, res) => {
  try {
    const { sessionId, eventName, properties } = req.body || {};

    if (!sessionId || typeof sessionId !== 'string' || sessionId.length > 120) {
      return res.status(400).json({ error: 'Valid sessionId is required' });
    }

    if (
      !eventName ||
      typeof eventName !== 'string' ||
      !ALLOWED_ANALYTICS_EVENT_NAME.test(eventName)
    ) {
      return res.status(400).json({ error: 'Valid snake_case eventName is required' });
    }

    const safeProperties = isPlainObject(properties) ? properties : {};

    if (JSON.stringify(safeProperties).length > MAX_ANALYTICS_PROPERTIES_LENGTH) {
      return res.status(400).json({ error: 'Analytics properties payload is too large' });
    }

    const createdAt = await saveAnalyticsEvent(sessionId, eventName, safeProperties);
    return res.json({ ok: true, createdAt });
  } catch (error) {
    console.error('Analytics event error:', error);
    return res.status(500).json({ error: 'Unable to save analytics event' });
  }
});

app.get('/api/analytics/summary', async (req, res) => {
  try {
    return res.json(await getAnalyticsSummary());
  } catch (error) {
    console.error('Analytics summary error:', error);
    return res.status(500).json({ error: 'Unable to load analytics summary' });
  }
});

app.get('/api/admin/export', async (req, res) => {
  try {
    const exportPayload = await exportAdminData();
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename=\"health-assessment-admin-export-${timestamp}.json\"`
    );

    return res.status(200).send(JSON.stringify(exportPayload, null, 2));
  } catch (error) {
    console.error('Admin export error:', error);
    return res.status(500).json({ error: 'Unable to export admin data' });
  }
});

app.post('/api/admin/restore', async (req, res) => {
  try {
    const payload = req.body;

    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return res.status(400).json({ error: 'A valid export payload is required.' });
    }

    const restoreResult = await restoreAdminData(payload);
    return res.status(200).json({
      ok: true,
      restoredProfiles: restoreResult.restoredProfiles,
      restoredAnalyticsEvents: restoreResult.restoredAnalyticsEvents
    });
  } catch (error) {
    console.error('Admin restore error:', error);
    return res.status(500).json({ error: 'Unable to restore admin data' });
  }
});

// Only listen when running locally (not on Vercel)
if (process.env.NODE_ENV !== 'production') {
  app.listen(PORT, () => {
    console.log(`Health Assessment Server running on port ${PORT}`);
    console.log(`Open http://localhost:${PORT} to access the application`);
  });
}

// Export for Vercel
module.exports = app;
