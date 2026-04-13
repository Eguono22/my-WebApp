const express = require('express');
const path = require('path');
const fs = require('fs/promises');
const { DatabaseSync } = require('node:sqlite');
const app = express();
const PORT = process.env.PORT || 3000;
const ANALYTICS_ADMIN_USERNAME = 'admin';

const SYNC_DB_FILE = path.join(__dirname, 'data', 'syncedHistory.db');
const SYNC_DATA_FILE = path.join(__dirname, 'data', 'syncedHistory.json');
let syncDb = null;
const syncStoreReady = initializeSyncStore();

function sanitizeProfileId(rawId) {
  return String(rawId || '')
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, '')
    .slice(0, 40);
}

function getAnalyticsAdminPassword() {
  return String(process.env.ANALYTICS_ADMIN_PASSWORD || '').trim();
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

app.use(express.json());
app.use(['/analytics', '/analytics.html', '/api/analytics/summary'], requireAnalyticsAuth);

app.get('/analytics', (req, res) => {
  res.redirect('/analytics.html');
});

app.get('/analytics.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'analytics.html'));
});

app.use(express.static('public'));

async function ensureSyncDataDirectory() {
  const dirPath = path.dirname(SYNC_DB_FILE);
  await fs.mkdir(dirPath, { recursive: true });
}

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

async function readLegacySyncStore() {
  await ensureSyncDataDirectory();
  try {
    await fs.access(SYNC_DATA_FILE);
  } catch {
    return {};
  }
  const raw = await fs.readFile(SYNC_DATA_FILE, 'utf8');
  if (!raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

async function migrateLegacySyncStore() {
  const legacyStore = await readLegacySyncStore();
  const legacyProfiles = Object.entries(legacyStore);

  if (!legacyProfiles.length) {
    return;
  }

  const insertProfile = syncDb.prepare(`
    INSERT OR REPLACE INTO synced_profiles (
      profile_id,
      history_json,
      goal_target,
      updated_at
    ) VALUES (?, ?, ?, ?)
  `);

  for (const [profileId, profileData] of legacyProfiles) {
    const normalizedHistory = Array.isArray(profileData.history)
      ? profileData.history.map(normalizeHistoryEntry)
      : [];

    insertProfile.run(
      profileId,
      JSON.stringify(normalizedHistory),
      normalizeGoalTarget(profileData.goalTarget),
      String(profileData.updatedAt || new Date().toISOString())
    );
  }

  let migratedFilePath = path.join(path.dirname(SYNC_DATA_FILE), 'syncedHistory.migrated.json');
  try {
    await fs.access(migratedFilePath);
    migratedFilePath = path.join(
      path.dirname(SYNC_DATA_FILE),
      `syncedHistory.migrated-${Date.now()}.json`
    );
  } catch {
    // Use the default migrated file name when it does not exist yet.
  }

  await fs.rename(SYNC_DATA_FILE, migratedFilePath);
}

async function initializeSyncStore() {
  await ensureSyncDataDirectory();
  syncDb = new DatabaseSync(SYNC_DB_FILE);

  if (process.env.VERCEL) {
    console.warn(
      'SQLite sync storage is active, but Vercel filesystem storage is not durable across instances. Move sync data to a managed database for production use.'
    );
  }

  syncDb.exec(`
    CREATE TABLE IF NOT EXISTS synced_profiles (
      profile_id TEXT PRIMARY KEY,
      history_json TEXT NOT NULL,
      goal_target INTEGER NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);

  syncDb.exec(`
    CREATE TABLE IF NOT EXISTS analytics_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      event_name TEXT NOT NULL,
      properties_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    )
  `);

  const row = syncDb.prepare('SELECT COUNT(*) AS count FROM synced_profiles').get();
  if (Number(row.count) === 0) {
    await migrateLegacySyncStore();
  }
}

function saveSyncedProfile(profileId, history, goalTarget) {
  const updatedAt = new Date().toISOString();
  const statement = syncDb.prepare(`
    INSERT INTO synced_profiles (
      profile_id,
      history_json,
      goal_target,
      updated_at
    ) VALUES (?, ?, ?, ?)
    ON CONFLICT(profile_id) DO UPDATE SET
      history_json = excluded.history_json,
      goal_target = excluded.goal_target,
      updated_at = excluded.updated_at
  `);

  statement.run(
    profileId,
    JSON.stringify(history),
    normalizeGoalTarget(goalTarget),
    updatedAt
  );

  return updatedAt;
}

function getSyncedProfile(profileId) {
  const row = syncDb.prepare(`
    SELECT history_json, goal_target, updated_at
    FROM synced_profiles
    WHERE profile_id = ?
  `).get(profileId);

  if (!row) {
    return null;
  }

  let history = [];
  try {
    const parsedHistory = JSON.parse(row.history_json);
    history = Array.isArray(parsedHistory)
      ? parsedHistory.map(normalizeHistoryEntry)
      : [];
  } catch {
    history = [];
  }

  return {
    history,
    goalTarget: normalizeGoalTarget(row.goal_target),
    updatedAt: String(row.updated_at || '')
  };
}

function saveAnalyticsEvent(sessionId, eventName, properties) {
  const createdAt = new Date().toISOString();
  syncDb.prepare(`
    INSERT INTO analytics_events (
      session_id,
      event_name,
      properties_json,
      created_at
    ) VALUES (?, ?, ?, ?)
  `).run(
    String(sessionId || 'anonymous'),
    String(eventName || 'unknown'),
    JSON.stringify(properties || {}),
    createdAt
  );

  return createdAt;
}

function roundRate(numerator, denominator) {
  if (!denominator) {
    return 0;
  }

  return Math.round((numerator / denominator) * 1000) / 10;
}

function getAnalyticsSummary() {
  const rows = syncDb.prepare(`
    SELECT session_id, event_name, properties_json, created_at
    FROM analytics_events
    ORDER BY created_at DESC
  `).all();

  const eventCounts = {};
  const uniqueSessions = new Set();
  const scoreValues = [];
  const dailyMap = new Map();
  const today = new Date();

  rows.forEach((row) => {
    uniqueSessions.add(String(row.session_id));
    eventCounts[row.event_name] = (eventCounts[row.event_name] || 0) + 1;

    let properties = {};
    try {
      properties = JSON.parse(row.properties_json);
    } catch {
      properties = {};
    }

    if (
      row.event_name === 'assessment_completed' &&
      properties &&
      typeof properties.overallScore === 'number'
    ) {
      scoreValues.push(properties.overallScore);
    }

    const dayKey = String(row.created_at).slice(0, 10);
    const existingDay = dailyMap.get(dayKey) || {
      date: dayKey,
      pageViews: 0,
      assessmentsCompleted: 0,
      chatOpens: 0
    };

    if (row.event_name === 'page_view') {
      existingDay.pageViews += 1;
    }

    if (row.event_name === 'assessment_completed') {
      existingDay.assessmentsCompleted += 1;
    }

    if (row.event_name === 'chat_opened') {
      existingDay.chatOpens += 1;
    }

    dailyMap.set(dayKey, existingDay);
  });

  const recentDaily = [];
  for (let offset = 6; offset >= 0; offset -= 1) {
    const date = new Date(today);
    date.setDate(today.getDate() - offset);
    const dayKey = date.toISOString().slice(0, 10);
    recentDaily.push(
      dailyMap.get(dayKey) || {
        date: dayKey,
        pageViews: 0,
        assessmentsCompleted: 0,
        chatOpens: 0
      }
    );
  }

  const pageViews = eventCounts.page_view || 0;
  const formStarts = eventCounts.form_started || 0;
  const assessmentsCompleted = eventCounts.assessment_completed || 0;
  const chatOpens = eventCounts.chat_opened || 0;

  return {
    generatedAt: new Date().toISOString(),
    totals: {
      totalEvents: rows.length,
      uniqueSessions: uniqueSessions.size,
      pageViews,
      formStarts,
      assessmentsCompleted,
      chatOpens,
      chatMessagesSent: eventCounts.chat_message_sent || 0,
      resultsShared: eventCounts.results_shared || 0,
      goalsSaved: eventCounts.goal_saved || 0,
      historySyncSaves: eventCounts.history_sync_saved || 0,
      historySyncLoads: eventCounts.history_sync_loaded || 0,
      exampleDataUses: eventCounts.form_example_used || 0,
      draftRestores: eventCounts.form_draft_restored || 0,
      draftClears: eventCounts.form_draft_cleared || 0
    },
    conversion: {
      formStartRate: roundRate(formStarts, pageViews),
      assessmentCompletionRate: roundRate(assessmentsCompleted, pageViews),
      assessmentFromStartRate: roundRate(assessmentsCompleted, formStarts),
      chatOpenRate: roundRate(chatOpens, pageViews)
    },
    assessment: {
      averageScore: scoreValues.length
        ? Math.round(
            (scoreValues.reduce((sum, value) => sum + value, 0) / scoreValues.length) * 10
          ) / 10
        : null
    },
    recentDaily,
    topEvents: Object.entries(eventCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([eventName, count]) => ({ eventName, count }))
  };
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
    this.conversationHistory = [];
  }

  generateResponse(userMessage, healthContext) {
    // Simple rule-based responses
    const message = userMessage.toLowerCase();
    
    // Check if user has health context
    if (healthContext && healthContext.overallScore) {
      // Context-aware responses
      if (message.includes('score') || message.includes('result')) {
        return this.explainScore(healthContext);
      }
      
      if (message.includes('bmi') || message.includes('weight')) {
        return this.explainBMI(healthContext);
      }
      
      if (message.includes('blood pressure') || message.includes('bp')) {
        return this.explainBloodPressure(healthContext);
      }
      
      if (message.includes('exercise') || message.includes('workout')) {
        return this.adviceExercise(healthContext);
      }
      
      if (message.includes('sleep')) {
        return this.adviceSleep(healthContext);
      }
      
      if (message.includes('stress')) {
        return this.adviceStress(healthContext);
      }
      
      if (message.includes('improve') || message.includes('better')) {
        return this.improvementSuggestions(healthContext);
      }
    }
    
    // General health questions
    if (message.includes('hello') || message.includes('hi')) {
      return "Hello! I'm your Health Assistant. I can help you understand your health metrics, provide general wellness guidance, and answer questions about your assessment results. How can I assist you today?";
    }
    
    if (message.includes('what can you do') || message.includes('help')) {
      return "I can help you with:\n\n• Understanding your health assessment results\n• Explaining health metrics like BMI, blood pressure, and heart rate\n• Providing personalized recommendations for improvement\n• Answering questions about diet, exercise, sleep, and stress management\n• Offering wellness tips and motivation\n\nFeel free to ask me anything!";
    }
    
    if (message.includes('diet') || message.includes('food') || message.includes('eat')) {
      return "A healthy diet is crucial for overall wellbeing! Focus on:\n\n• Plenty of fruits and vegetables (5-9 servings daily)\n• Whole grains over refined carbohydrates\n• Lean proteins (fish, chicken, beans, legumes)\n• Healthy fats (nuts, avocados, olive oil)\n• Limit processed foods, sugar, and sodium\n• Stay hydrated (8-10 glasses of water daily)\n\nWould you like specific dietary advice based on your health goals?";
    }
    
    if (message.includes('heart') || message.includes('cardiovascular')) {
      return "Heart health is vital! Here are key tips:\n\n• Exercise regularly (150 minutes moderate activity per week)\n• Maintain healthy blood pressure (<120/80 mmHg)\n• Keep cholesterol levels in check\n• Don't smoke or use tobacco\n• Manage stress effectively\n• Eat a heart-healthy diet (low in saturated fats)\n• Maintain a healthy weight\n\nRegular check-ups with your doctor are essential!";
    }
    
    // Default response
    return "That's an interesting question! While I can provide general health information, I recommend consulting with healthcare professionals for specific medical advice. Is there a particular health topic you'd like to know more about, such as nutrition, exercise, sleep, or stress management?";
  }
  
  explainScore(context) {
    const score = context.overallScore;
    const status = context.status;
    
    let response = `Your overall health score is ${score}/100, which is categorized as "${status}". `;
    
    if (score >= 85) {
      response += "Excellent! You're in great health. Your lifestyle choices are contributing positively to your wellbeing. Keep up the fantastic work with your current habits!";
    } else if (score >= 70) {
      response += "Good work! You're maintaining decent health, but there's room for optimization. Focus on improving your lower-scoring metrics to reach excellent health.";
    } else if (score >= 50) {
      response += "Your health needs some attention. I recommend focusing on the areas where you scored lower. Small, consistent improvements in diet, exercise, and sleep can make a significant difference.";
    } else {
      response += "Your health requires immediate attention. Please consult with a healthcare provider for a comprehensive evaluation. In the meantime, start with small changes: increase physical activity, improve sleep habits, and manage stress better.";
    }
    
    response += "\n\nWould you like specific advice on any health metric?";
    return response;
  }
  
  explainBMI(context) {
    const bmi = context.bmi;
    let category, advice;
    
    if (bmi < 18.5) {
      category = "underweight";
      advice = "Consider consulting a nutritionist to develop a healthy weight gain plan. Focus on nutrient-dense foods and strength training to build muscle mass.";
    } else if (bmi < 25) {
      category = "normal weight";
      advice = "Great! Maintain your current weight through balanced nutrition and regular exercise. Continue your healthy lifestyle habits!";
    } else if (bmi < 30) {
      category = "overweight";
      advice = "Focus on creating a caloric deficit through portion control and increased physical activity. Aim to lose 1-2 pounds per week safely. Consider consulting a dietitian for personalized guidance.";
    } else {
      category = "obese";
      advice = "I recommend working with healthcare professionals to develop a comprehensive weight management plan. Focus on sustainable lifestyle changes rather than quick fixes. Small, consistent improvements matter!";
    }
    
    return `Your BMI is ${bmi}, which falls in the "${category}" category. ${advice}\n\nRemember, BMI is just one indicator and doesn't account for muscle mass or body composition. Would you like tips on healthy nutrition or exercise?`;
  }
  
  explainBloodPressure(context) {
    const systolic = context.systolic;
    const diastolic = context.diastolic;
    
    let response = `Your blood pressure reading is ${systolic}/${diastolic} mmHg. `;
    
    if (systolic < 120 && diastolic < 80) {
      response += "This is excellent! You have normal blood pressure. Maintain your healthy lifestyle to keep it in this range.";
    } else if (systolic < 130 && diastolic < 85) {
      response += "This is slightly elevated. Watch your sodium intake, exercise regularly, manage stress, and monitor your blood pressure regularly.";
    } else if (systolic < 140 && diastolic < 90) {
      response += "This indicates Stage 1 hypertension. Lifestyle modifications are important: reduce sodium, exercise more, limit alcohol, manage stress, and maintain healthy weight. Consult your doctor.";
    } else {
      response += "This is concerning and should be evaluated by a healthcare provider soon. In the meantime, reduce sodium intake, avoid excessive stress, and monitor your blood pressure regularly.";
    }
    
    response += "\n\nWould you like tips on managing blood pressure through lifestyle changes?";
    return response;
  }
  
  adviceExercise(context) {
    const exerciseHours = context.exerciseHours;
    
    let response = `You're currently exercising ${exerciseHours} hours per week. `;
    
    if (exerciseHours >= 5) {
      response += "Excellent! You're meeting and exceeding guidelines. Ensure you're including variety: cardio, strength training, and flexibility exercises. Don't forget rest days for recovery!";
    } else if (exerciseHours >= 3) {
      response += "Good effort! You're meeting basic guidelines. Try to reach 5+ hours weekly by adding activities you enjoy. Mix cardio and strength training for optimal results.";
    } else if (exerciseHours >= 1) {
      response += "You're making a start! Gradually increase to 3-5 hours weekly. Start with activities you enjoy - walking, swimming, cycling, or dancing. Consistency is key!";
    } else {
      response += "Let's get you moving! Start small: 10-15 minutes of daily walking. Gradually increase duration and intensity. Find activities you enjoy to make exercise sustainable.";
    }
    
    response += "\n\nRecommended weekly exercise:\n• 150 minutes moderate cardio (brisk walking, cycling)\n• 2-3 strength training sessions\n• Daily stretching or yoga\n\nWould you like specific workout suggestions?";
    return response;
  }
  
  adviceSleep(context) {
    const sleepHours = context.sleepHours;
    
    let response = `You're getting ${sleepHours} hours of sleep per night. `;
    
    if (sleepHours >= 7 && sleepHours <= 9) {
      response += "Perfect! You're getting optimal sleep. Maintain consistent sleep/wake times, even on weekends, for best results.";
    } else if (sleepHours < 7) {
      response += "You need more sleep! Aim for 7-9 hours nightly. Tips:\n• Set a consistent bedtime\n• Create a relaxing pre-sleep routine\n• Avoid screens 1 hour before bed\n• Keep bedroom cool and dark\n• Limit caffeine after 2 PM\n• Avoid heavy meals before bedtime";
    } else {
      response += "You might be sleeping too much. While individual needs vary, 7-9 hours is typically optimal. Excessive sleep can indicate underlying issues. Consider consulting a healthcare provider if you regularly need 10+ hours.";
    }
    
    response += "\n\nQuality matters as much as quantity! Would you like tips for improving sleep quality?";
    return response;
  }
  
  adviceStress(context) {
    const stressLevel = context.stressLevel;
    
    let response = `Your stress level is `;
    
    if (stressLevel <= 2) {
      response += "low - that's wonderful! Keep up your stress management practices. Remember to maintain work-life balance and practice self-care regularly.";
    } else if (stressLevel === 3) {
      response += "moderate. While manageable, consider implementing more stress reduction techniques:\n\n• Daily meditation or deep breathing (10-15 min)\n• Regular exercise\n• Adequate sleep\n• Social connections\n• Time management\n• Hobbies and relaxation activities";
    } else {
      response += "high, which can impact your overall health. Priority actions:\n\n• Practice daily relaxation (meditation, yoga, deep breathing)\n• Exercise regularly - it's a natural stress reliever\n• Talk to someone (friend, family, or counselor)\n• Identify stress triggers and develop coping strategies\n• Ensure adequate sleep\n• Consider professional support if stress is overwhelming\n\nChronic stress affects physical health, so addressing it is crucial!";
    }
    
    response += "\n\nWould you like specific stress management techniques?";
    return response;
  }
  
  improvementSuggestions(context) {
    const scores = context.detailedScores;
    const lowestScores = Object.entries(scores)
      .sort((a, b) => a[1] - b[1])
      .slice(0, 3);
    
    let response = "Based on your assessment, here are priority areas for improvement:\n\n";
    
    const metricAdvice = {
      bmi: "Work on achieving healthy weight through balanced nutrition and regular exercise",
      bloodPressure: "Focus on reducing sodium, increasing potassium-rich foods, and managing stress",
      heartRate: "Regular cardiovascular exercise can help optimize your resting heart rate",
      exercise: "Gradually increase physical activity - aim for 150 minutes of moderate exercise weekly",
      sleep: "Prioritize 7-9 hours of quality sleep by maintaining consistent sleep schedule",
      stress: "Implement daily stress management techniques like meditation, yoga, or deep breathing"
    };
    
    lowestScores.forEach(([metric, score], index) => {
      response += `${index + 1}. ${metric.toUpperCase()} (Score: ${Math.round(score)}/100)\n   ${metricAdvice[metric] || 'Consult with healthcare provider for personalized advice'}\n\n`;
    });
    
    response += "Focus on one area at a time for sustainable improvement. Small, consistent changes lead to lasting results!\n\nWhich area would you like to work on first?";
    return response;
  }
}

const chatAgent = new HealthChatAgent();

// API endpoint for AI chat
app.post('/api/chat', (req, res) => {
  try {
    const { message, context } = req.body;
    
    if (!message) {
      return res.status(400).json({ error: 'Message is required' });
    }
    
    const response = chatAgent.generateResponse(message, context);
    
    res.json({ response });
  } catch (error) {
    console.error('Chat error:', error);
    res.status(500).json({ 
      error: 'An error occurred while processing your message' 
    });
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
    await syncStoreReady;
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

    const normalizedHistory = history.map(normalizeHistoryEntry);
    const updatedAt = saveSyncedProfile(profileId, normalizedHistory, goalTarget);
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
    await syncStoreReady;
    const profileId = sanitizeProfileId(req.params.profileId);

    if (!profileId) {
      return res.status(400).json({ error: 'Valid profileId is required' });
    }

    const data = getSyncedProfile(profileId);

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
    await syncStoreReady;
    const { sessionId, eventName, properties } = req.body || {};

    if (!sessionId || typeof sessionId !== 'string' || sessionId.length > 120) {
      return res.status(400).json({ error: 'Valid sessionId is required' });
    }

    if (!eventName || typeof eventName !== 'string' || eventName.length > 80) {
      return res.status(400).json({ error: 'Valid eventName is required' });
    }

    const safeProperties =
      properties && typeof properties === 'object' && !Array.isArray(properties)
        ? properties
        : {};

    const createdAt = saveAnalyticsEvent(sessionId, eventName, safeProperties);
    return res.json({ ok: true, createdAt });
  } catch (error) {
    console.error('Analytics event error:', error);
    return res.status(500).json({ error: 'Unable to save analytics event' });
  }
});

app.get('/api/analytics/summary', async (req, res) => {
  try {
    await syncStoreReady;
    return res.json(getAnalyticsSummary());
  } catch (error) {
    console.error('Analytics summary error:', error);
    return res.status(500).json({ error: 'Unable to load analytics summary' });
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
