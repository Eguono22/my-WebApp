const fs = require('fs/promises');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const { neon } = require('@neondatabase/serverless');

const SYNC_DB_FILE = path.join(__dirname, '..', 'data', 'syncedHistory.db');
const SYNC_DATA_FILE = path.join(__dirname, '..', 'data', 'syncedHistory.json');

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

function parseJsonObject(rawValue, fallbackValue) {
  try {
    return JSON.parse(rawValue);
  } catch {
    return fallbackValue;
  }
}

function roundRate(numerator, denominator) {
  if (!denominator) {
    return 0;
  }

  return Math.round((numerator / denominator) * 1000) / 10;
}

function buildAnalyticsSummary(rows) {
  const eventCounts = {};
  const uniqueSessions = new Set();
  const scoreValues = [];
  const dailyMap = new Map();
  const today = new Date();

  rows.forEach((row) => {
    uniqueSessions.add(String(row.session_id));
    eventCounts[row.event_name] = (eventCounts[row.event_name] || 0) + 1;

    const properties = parseJsonObject(row.properties_json, {});

    if (row.event_name === 'assessment_completed' && typeof properties.overallScore === 'number') {
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

function normalizeExportedProfile(row) {
  const parsedHistory = parseJsonObject(row.history_json, []);

  return {
    profileId: String(row.profile_id || ''),
    goalTarget: normalizeGoalTarget(row.goal_target),
    updatedAt: String(row.updated_at || ''),
    history: Array.isArray(parsedHistory) ? parsedHistory.map(normalizeHistoryEntry) : [],
    historyCount: Array.isArray(parsedHistory) ? parsedHistory.length : 0
  };
}

async function ensureSyncDataDirectory() {
  await fs.mkdir(path.dirname(SYNC_DB_FILE), { recursive: true });
}

async function readLegacySyncStore() {
  await ensureSyncDataDirectory();
  try {
    await fs.access(SYNC_DATA_FILE);
  } catch {
    return {};
  }

  const raw = await fs.readFile(SYNC_DATA_FILE, 'utf8');
  if (!raw.trim()) {
    return {};
  }

  const parsed = parseJsonObject(raw, {});
  return parsed && typeof parsed === 'object' ? parsed : {};
}

async function archiveLegacySyncStore() {
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

async function readSqliteSeedData() {
  try {
    await fs.access(SYNC_DB_FILE);
  } catch {
    return { profiles: [], events: [] };
  }

  const sqliteDb = new DatabaseSync(SYNC_DB_FILE);

  try {
    const tableExists = (tableName) =>
      Boolean(
        sqliteDb
          .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
          .get(tableName)
      );

    const profiles = tableExists('synced_profiles')
      ? sqliteDb.prepare(`
          SELECT profile_id, history_json, goal_target, updated_at
          FROM synced_profiles
        `).all()
      : [];

    const events = tableExists('analytics_events')
      ? sqliteDb.prepare(`
          SELECT session_id, event_name, properties_json, created_at
          FROM analytics_events
        `).all()
      : [];

    return { profiles, events };
  } finally {
    if (typeof sqliteDb.close === 'function') {
      sqliteDb.close();
    }
  }
}

async function createSqliteStorage() {
  await ensureSyncDataDirectory();
  const sqliteDb = new DatabaseSync(SYNC_DB_FILE);

  sqliteDb.exec(`
    CREATE TABLE IF NOT EXISTS synced_profiles (
      profile_id TEXT PRIMARY KEY,
      history_json TEXT NOT NULL,
      goal_target INTEGER NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);

  sqliteDb.exec(`
    CREATE TABLE IF NOT EXISTS analytics_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      event_name TEXT NOT NULL,
      properties_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    )
  `);

  const profileCount = Number(
    sqliteDb.prepare('SELECT COUNT(*) AS count FROM synced_profiles').get().count || 0
  );

  if (profileCount === 0) {
    const legacyStore = await readLegacySyncStore();
    const legacyProfiles = Object.entries(legacyStore);

    if (legacyProfiles.length) {
      const insertProfile = sqliteDb.prepare(`
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

      await archiveLegacySyncStore();
    }
  }

  return {
    label: 'sqlite',
    async saveSyncedProfile(profileId, history, goalTarget) {
      const updatedAt = new Date().toISOString();
      sqliteDb.prepare(`
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
      `).run(profileId, JSON.stringify(history), normalizeGoalTarget(goalTarget), updatedAt);

      return updatedAt;
    },
    async getSyncedProfile(profileId) {
      const row = sqliteDb.prepare(`
        SELECT history_json, goal_target, updated_at
        FROM synced_profiles
        WHERE profile_id = ?
      `).get(profileId);

      if (!row) {
        return null;
      }

      const parsedHistory = parseJsonObject(row.history_json, []);

      return {
        history: Array.isArray(parsedHistory) ? parsedHistory.map(normalizeHistoryEntry) : [],
        goalTarget: normalizeGoalTarget(row.goal_target),
        updatedAt: String(row.updated_at || '')
      };
    },
    async saveAnalyticsEvent(sessionId, eventName, properties) {
      const createdAt = new Date().toISOString();
      sqliteDb.prepare(`
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
    },
    async getAnalyticsSummary() {
      const rows = sqliteDb.prepare(`
        SELECT session_id, event_name, properties_json, created_at
        FROM analytics_events
        ORDER BY created_at DESC
      `).all();

      return buildAnalyticsSummary(rows);
    },
    async exportAdminData() {
      const analyticsRows = sqliteDb.prepare(`
        SELECT session_id, event_name, properties_json, created_at
        FROM analytics_events
        ORDER BY created_at DESC
      `).all();

      const profileRows = sqliteDb.prepare(`
        SELECT profile_id, history_json, goal_target, updated_at
        FROM synced_profiles
        ORDER BY updated_at DESC
      `).all();

      return {
        storage: 'sqlite',
        generatedAt: new Date().toISOString(),
        analyticsSummary: buildAnalyticsSummary(analyticsRows),
        syncedProfiles: profileRows.map(normalizeExportedProfile)
      };
    }
  };
}

async function importLegacyProfilesToPostgres(sql) {
  const legacyStore = await readLegacySyncStore();
  const legacyProfiles = Object.entries(legacyStore);

  for (const [profileId, profileData] of legacyProfiles) {
    const normalizedHistory = Array.isArray(profileData.history)
      ? profileData.history.map(normalizeHistoryEntry)
      : [];

    await sql`
      INSERT INTO synced_profiles (
        profile_id,
        history_json,
        goal_target,
        updated_at
      ) VALUES (
        ${profileId},
        ${JSON.stringify(normalizedHistory)},
        ${normalizeGoalTarget(profileData.goalTarget)},
        ${String(profileData.updatedAt || new Date().toISOString())}
      )
      ON CONFLICT (profile_id) DO UPDATE SET
        history_json = EXCLUDED.history_json,
        goal_target = EXCLUDED.goal_target,
        updated_at = EXCLUDED.updated_at
    `;
  }

  if (legacyProfiles.length) {
    await archiveLegacySyncStore();
  }
}

async function importSqliteDataToPostgres(sql, sqliteData) {
  for (const profile of sqliteData.profiles) {
    await sql`
      INSERT INTO synced_profiles (
        profile_id,
        history_json,
        goal_target,
        updated_at
      ) VALUES (
        ${String(profile.profile_id || '')},
        ${String(profile.history_json || '[]')},
        ${normalizeGoalTarget(profile.goal_target)},
        ${String(profile.updated_at || new Date().toISOString())}
      )
      ON CONFLICT (profile_id) DO UPDATE SET
        history_json = EXCLUDED.history_json,
        goal_target = EXCLUDED.goal_target,
        updated_at = EXCLUDED.updated_at
    `;
  }

  for (const event of sqliteData.events) {
    await sql`
      INSERT INTO analytics_events (
        session_id,
        event_name,
        properties_json,
        created_at
      ) VALUES (
        ${String(event.session_id || 'anonymous')},
        ${String(event.event_name || 'unknown')},
        ${String(event.properties_json || '{}')},
        ${String(event.created_at || new Date().toISOString())}
      )
    `;
  }
}

async function createPostgresStorage() {
  const sql = neon(process.env.DATABASE_URL);

  await sql`
    CREATE TABLE IF NOT EXISTS synced_profiles (
      profile_id TEXT PRIMARY KEY,
      history_json TEXT NOT NULL,
      goal_target INTEGER NOT NULL,
      updated_at TEXT NOT NULL
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS analytics_events (
      id BIGSERIAL PRIMARY KEY,
      session_id TEXT NOT NULL,
      event_name TEXT NOT NULL,
      properties_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    )
  `;

  const profileCountRows = await sql`SELECT COUNT(*)::int AS count FROM synced_profiles`;
  const eventCountRows = await sql`SELECT COUNT(*)::int AS count FROM analytics_events`;
  const profileCount = Number(profileCountRows[0]?.count || 0);
  const eventCount = Number(eventCountRows[0]?.count || 0);

  if (profileCount === 0 && eventCount === 0) {
    const sqliteData = await readSqliteSeedData();

    if (sqliteData.profiles.length || sqliteData.events.length) {
      await importSqliteDataToPostgres(sql, sqliteData);
    } else {
      await importLegacyProfilesToPostgres(sql);
    }
  }

  return {
    label: 'postgres',
    async saveSyncedProfile(profileId, history, goalTarget) {
      const updatedAt = new Date().toISOString();

      await sql`
        INSERT INTO synced_profiles (
          profile_id,
          history_json,
          goal_target,
          updated_at
        ) VALUES (
          ${profileId},
          ${JSON.stringify(history)},
          ${normalizeGoalTarget(goalTarget)},
          ${updatedAt}
        )
        ON CONFLICT (profile_id) DO UPDATE SET
          history_json = EXCLUDED.history_json,
          goal_target = EXCLUDED.goal_target,
          updated_at = EXCLUDED.updated_at
      `;

      return updatedAt;
    },
    async getSyncedProfile(profileId) {
      const rows = await sql`
        SELECT history_json, goal_target, updated_at
        FROM synced_profiles
        WHERE profile_id = ${profileId}
        LIMIT 1
      `;

      const row = rows[0];
      if (!row) {
        return null;
      }

      const parsedHistory = parseJsonObject(row.history_json, []);

      return {
        history: Array.isArray(parsedHistory) ? parsedHistory.map(normalizeHistoryEntry) : [],
        goalTarget: normalizeGoalTarget(row.goal_target),
        updatedAt: String(row.updated_at || '')
      };
    },
    async saveAnalyticsEvent(sessionId, eventName, properties) {
      const createdAt = new Date().toISOString();

      await sql`
        INSERT INTO analytics_events (
          session_id,
          event_name,
          properties_json,
          created_at
        ) VALUES (
          ${String(sessionId || 'anonymous')},
          ${String(eventName || 'unknown')},
          ${JSON.stringify(properties || {})},
          ${createdAt}
        )
      `;

      return createdAt;
    },
    async getAnalyticsSummary() {
      const rows = await sql`
        SELECT session_id, event_name, properties_json, created_at
        FROM analytics_events
        ORDER BY created_at DESC
      `;

      return buildAnalyticsSummary(rows);
    },
    async exportAdminData() {
      const analyticsRows = await sql`
        SELECT session_id, event_name, properties_json, created_at
        FROM analytics_events
        ORDER BY created_at DESC
      `;

      const profileRows = await sql`
        SELECT profile_id, history_json, goal_target, updated_at
        FROM synced_profiles
        ORDER BY updated_at DESC
      `;

      return {
        storage: 'postgres',
        generatedAt: new Date().toISOString(),
        analyticsSummary: buildAnalyticsSummary(analyticsRows),
        syncedProfiles: profileRows.map(normalizeExportedProfile)
      };
    }
  };
}

async function createStorage() {
  if (process.env.DATABASE_URL) {
    return createPostgresStorage();
  }

  if (process.env.VERCEL) {
    console.warn(
      'SQLite storage is active on Vercel. Connect a managed Postgres database by setting DATABASE_URL for durable production data.'
    );
  }

  return createSqliteStorage();
}

module.exports = {
  createStorage
};
