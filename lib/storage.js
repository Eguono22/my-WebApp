const fs = require('fs/promises');
const path = require('path');
const { neon } = require('@neondatabase/serverless');

let DatabaseSync = null;
try {
  ({ DatabaseSync } = require('node:sqlite'));
} catch {
  DatabaseSync = null;
}

const DATA_DIRECTORY = process.env.DATA_DIRECTORY || path.join(__dirname, '..', 'data');
const SYNC_DB_FILE = path.join(DATA_DIRECTORY, 'syncedHistory.db');
const SYNC_DATA_FILE = path.join(DATA_DIRECTORY, 'syncedHistory.json');
const JSON_STORAGE_FILE = path.join(DATA_DIRECTORY, 'storage-fallback.json');

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

function normalizeProfileId(rawId) {
  return String(rawId || '')
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, '')
    .slice(0, 40);
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
    authTokenHash: String(row.auth_token_hash || ''),
    goalTarget: normalizeGoalTarget(row.goal_target),
    updatedAt: String(row.updated_at || ''),
    history: Array.isArray(parsedHistory) ? parsedHistory.map(normalizeHistoryEntry) : [],
    historyCount: Array.isArray(parsedHistory) ? parsedHistory.length : 0
  };
}

function normalizeExportedEvent(row) {
  return {
    sessionId: String(row.session_id || 'anonymous'),
    eventName: String(row.event_name || 'unknown'),
    properties: parseJsonObject(row.properties_json, {}),
    createdAt: String(row.created_at || '')
  };
}

function normalizeRestorePayload(payload) {
  const source = payload && typeof payload === 'object' ? payload : {};
  const rawProfiles = Array.isArray(source.syncedProfiles) ? source.syncedProfiles : [];
  const rawEvents = Array.isArray(source.analyticsEvents) ? source.analyticsEvents : [];

  const syncedProfiles = rawProfiles
    .map((profile) => {
      const profileId = normalizeProfileId(profile.profileId);
      if (!profileId) {
        return null;
      }

      const history = Array.isArray(profile.history)
        ? profile.history.map(normalizeHistoryEntry).slice(0, 500)
        : [];

      return {
        profileId,
        authTokenHash: String(profile.authTokenHash || ''),
        history,
        goalTarget: normalizeGoalTarget(profile.goalTarget),
        updatedAt: String(profile.updatedAt || new Date().toISOString())
      };
    })
    .filter(Boolean);

  const analyticsEvents = rawEvents
    .map((event) => ({
      sessionId: String(event.sessionId || 'anonymous').slice(0, 120),
      eventName: String(event.eventName || 'unknown').slice(0, 80),
      properties:
        event.properties && typeof event.properties === 'object' && !Array.isArray(event.properties)
          ? event.properties
          : {},
      createdAt: String(event.createdAt || new Date().toISOString())
    }))
    .filter((event) => event.sessionId && event.eventName);

  return {
    syncedProfiles,
    analyticsEvents
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

async function readJsonStorageState() {
  await ensureSyncDataDirectory();

  try {
    await fs.access(JSON_STORAGE_FILE);
  } catch {
    const legacyStore = await readLegacySyncStore();
    const syncedProfiles = Object.entries(legacyStore).map(([profileId, profileData]) => ({
      profileId: normalizeProfileId(profileId),
      goalTarget: normalizeGoalTarget(profileData.goalTarget),
      updatedAt: String(profileData.updatedAt || new Date().toISOString()),
      history: Array.isArray(profileData.history)
        ? profileData.history.map(normalizeHistoryEntry).slice(0, 500)
        : []
    })).filter((profile) => profile.profileId);

    if (syncedProfiles.length) {
      await writeJsonStorageState({
        syncedProfiles,
        analyticsEvents: []
      });
      await archiveLegacySyncStore();
    }

    return {
      syncedProfiles,
      analyticsEvents: []
    };
  }

  const raw = await fs.readFile(JSON_STORAGE_FILE, 'utf8');
  if (!raw.trim()) {
    return {
      syncedProfiles: [],
      analyticsEvents: []
    };
  }

  const parsed = parseJsonObject(raw, {});
  const rawProfiles = Array.isArray(parsed.syncedProfiles) ? parsed.syncedProfiles : [];
  const rawEvents = Array.isArray(parsed.analyticsEvents) ? parsed.analyticsEvents : [];

  return {
    syncedProfiles: rawProfiles
      .map((profile) => ({
        profileId: normalizeProfileId(profile.profileId),
        authTokenHash: String(profile.authTokenHash || ''),
        goalTarget: normalizeGoalTarget(profile.goalTarget),
        updatedAt: String(profile.updatedAt || new Date().toISOString()),
        history: Array.isArray(profile.history)
          ? profile.history.map(normalizeHistoryEntry).slice(0, 500)
          : []
      }))
      .filter((profile) => profile.profileId),
    analyticsEvents: rawEvents
      .map((event) => ({
        sessionId: String(event.sessionId || 'anonymous').slice(0, 120),
        eventName: String(event.eventName || 'unknown').slice(0, 80),
        properties:
          event.properties && typeof event.properties === 'object' && !Array.isArray(event.properties)
            ? event.properties
            : {},
        createdAt: String(event.createdAt || new Date().toISOString())
      }))
      .filter((event) => event.sessionId && event.eventName)
  };
}

async function writeJsonStorageState(state) {
  await ensureSyncDataDirectory();
  const temporaryFile = `${JSON_STORAGE_FILE}.tmp`;
  await fs.writeFile(temporaryFile, `${JSON.stringify(state, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  await fs.rename(temporaryFile, JSON_STORAGE_FILE);
}

function createJsonStorageSummaryRows(state) {
  return state.analyticsEvents.map((event) => ({
    session_id: event.sessionId,
    event_name: event.eventName,
    properties_json: JSON.stringify(event.properties || {}),
    created_at: event.createdAt
  }));
}

async function createJsonStorage() {
  const state = await readJsonStorageState();

  let writeQueue = Promise.resolve();
  function persist() {
    const pending = writeQueue.then(() => writeJsonStorageState(state));
    writeQueue = pending.catch(() => {});
    return pending;
  }

  return {
    label: 'json',
    async createSyncedProfile(profileId, authTokenHash) {
      if (state.syncedProfiles.some((profile) => profile.profileId === profileId)) {
        throw new Error('Profile already exists');
      }
      state.syncedProfiles.push({ profileId, authTokenHash, history: [], goalTarget: 85, updatedAt: new Date().toISOString() });
      await persist();
    },
    async deleteSyncedProfile(profileId) {
      state.syncedProfiles = state.syncedProfiles.filter((profile) => profile.profileId !== profileId);
      await persist();
    },
    async saveSyncedProfile(profileId, history, goalTarget) {
      const normalizedProfileId = normalizeProfileId(profileId);
      const updatedAt = new Date().toISOString();
      const nextProfile = {
        profileId: normalizedProfileId,
        history: Array.isArray(history) ? history.map(normalizeHistoryEntry).slice(0, 500) : [],
        goalTarget: normalizeGoalTarget(goalTarget),
        updatedAt
      };
      const existingIndex = state.syncedProfiles.findIndex(
        (profile) => profile.profileId === normalizedProfileId
      );

      if (existingIndex >= 0) {
        nextProfile.authTokenHash = state.syncedProfiles[existingIndex].authTokenHash || '';
        state.syncedProfiles[existingIndex] = nextProfile;
      } else {
        state.syncedProfiles.push(nextProfile);
      }

      await persist();
      return updatedAt;
    },
    async getSyncedProfile(profileId) {
      const normalizedProfileId = normalizeProfileId(profileId);
      const profile = state.syncedProfiles.find(
        (candidate) => candidate.profileId === normalizedProfileId
      );

      if (!profile) {
        return null;
      }

      return {
        authTokenHash: String(profile.authTokenHash || ''),
        history: profile.history.map(normalizeHistoryEntry),
        goalTarget: normalizeGoalTarget(profile.goalTarget),
        updatedAt: String(profile.updatedAt || '')
      };
    },
    async saveAnalyticsEvent(sessionId, eventName, properties) {
      const createdAt = new Date().toISOString();
      state.analyticsEvents.push({
        sessionId: String(sessionId || 'anonymous').slice(0, 120),
        eventName: String(eventName || 'unknown').slice(0, 80),
        properties:
          properties && typeof properties === 'object' && !Array.isArray(properties)
            ? properties
            : {},
        createdAt
      });

      await persist();
      return createdAt;
    },
    async getAnalyticsSummary() {
      return buildAnalyticsSummary(createJsonStorageSummaryRows(state));
    },
    async exportAdminData() {
      const analyticsRows = createJsonStorageSummaryRows(state);

      return {
        storage: 'json',
        generatedAt: new Date().toISOString(),
        analyticsSummary: buildAnalyticsSummary(analyticsRows),
        analyticsEvents: state.analyticsEvents.map((event) => ({
          sessionId: event.sessionId,
          eventName: event.eventName,
          properties: event.properties,
          createdAt: event.createdAt
        })),
        syncedProfiles: state.syncedProfiles.map((profile) => ({
          profileId: profile.profileId,
          authTokenHash: String(profile.authTokenHash || ''),
          goalTarget: profile.goalTarget,
          updatedAt: profile.updatedAt,
          history: profile.history.map(normalizeHistoryEntry),
          historyCount: profile.history.length
        }))
      };
    },
    async restoreAdminData(payload) {
      const normalizedPayload = normalizeRestorePayload(payload);
      state.syncedProfiles = normalizedPayload.syncedProfiles.map((profile) => ({
        profileId: profile.profileId,
        authTokenHash: String(profile.authTokenHash || ''),
        goalTarget: profile.goalTarget,
        updatedAt: profile.updatedAt,
        history: profile.history.map(normalizeHistoryEntry)
      }));
      state.analyticsEvents = normalizedPayload.analyticsEvents.map((event) => ({
        sessionId: event.sessionId,
        eventName: event.eventName,
        properties: event.properties,
        createdAt: event.createdAt
      }));

      await persist();

      return {
        restoredProfiles: state.syncedProfiles.length,
        restoredAnalyticsEvents: state.analyticsEvents.length
      };
    }
  };
}

async function readSqliteSeedData() {
  if (!DatabaseSync) {
    return { profiles: [], events: [] };
  }

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
          SELECT *
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
  if (!DatabaseSync) {
    throw new Error('node:sqlite is not available in this runtime.');
  }

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

  if (!sqliteDb.prepare('PRAGMA table_info(synced_profiles)').all().some((column) => column.name === 'auth_token_hash')) {
    sqliteDb.exec("ALTER TABLE synced_profiles ADD COLUMN auth_token_hash TEXT NOT NULL DEFAULT ''");
  }

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
    async createSyncedProfile(profileId, authTokenHash) {
      sqliteDb.prepare('INSERT INTO synced_profiles (profile_id, history_json, goal_target, updated_at, auth_token_hash) VALUES (?, ?, ?, ?, ?)')
        .run(profileId, '[]', 85, new Date().toISOString(), authTokenHash);
    },
    async deleteSyncedProfile(profileId) {
      sqliteDb.prepare('DELETE FROM synced_profiles WHERE profile_id = ?').run(profileId);
    },
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
        SELECT history_json, goal_target, updated_at, auth_token_hash
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
        updatedAt: String(row.updated_at || ''),
        authTokenHash: String(row.auth_token_hash || '')
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
        SELECT profile_id, history_json, goal_target, updated_at, auth_token_hash
        FROM synced_profiles
        ORDER BY updated_at DESC
      `).all();

      return {
        storage: 'sqlite',
        generatedAt: new Date().toISOString(),
        analyticsSummary: buildAnalyticsSummary(analyticsRows),
        analyticsEvents: analyticsRows.map(normalizeExportedEvent),
        syncedProfiles: profileRows.map(normalizeExportedProfile)
      };
    },
    async restoreAdminData(payload) {
      const normalizedPayload = normalizeRestorePayload(payload);

      sqliteDb.exec('BEGIN');

      try {
        sqliteDb.prepare('DELETE FROM analytics_events').run();
        sqliteDb.prepare('DELETE FROM synced_profiles').run();

        const insertProfile = sqliteDb.prepare(`
          INSERT INTO synced_profiles (
            profile_id,
            history_json,
            goal_target,
            updated_at, auth_token_hash
          ) VALUES (?, ?, ?, ?, ?)
        `);

        const insertEvent = sqliteDb.prepare(`
          INSERT INTO analytics_events (
            session_id,
            event_name,
            properties_json,
            created_at
          ) VALUES (?, ?, ?, ?)
        `);

        normalizedPayload.syncedProfiles.forEach((profile) => {
          insertProfile.run(
            profile.profileId,
            JSON.stringify(profile.history),
            profile.goalTarget,
            profile.updatedAt,
            profile.authTokenHash
          );
        });

        normalizedPayload.analyticsEvents.forEach((event) => {
          insertEvent.run(
            event.sessionId,
            event.eventName,
            JSON.stringify(event.properties),
            event.createdAt
          );
        });

        sqliteDb.exec('COMMIT');
      } catch (error) {
        sqliteDb.exec('ROLLBACK');
        throw error;
      }

      return {
        restoredProfiles: normalizedPayload.syncedProfiles.length,
        restoredAnalyticsEvents: normalizedPayload.analyticsEvents.length
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
        updated_at, auth_token_hash
      ) VALUES (
        ${String(profile.profile_id || '')},
        ${String(profile.history_json || '[]')},
        ${normalizeGoalTarget(profile.goal_target)},
        ${String(profile.updated_at || new Date().toISOString())},
        ${String(profile.auth_token_hash || '')}
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
  // Fixed identifiers keep preview data isolated even when credentials share a database.
  const preview = process.env.VERCEL_ENV === 'preview';
  const profilesTable = sql.unsafe(preview ? 'health_preview.synced_profiles' : 'public.synced_profiles');
  const eventsTable = sql.unsafe(preview ? 'health_preview.analytics_events' : 'public.analytics_events');
  if (preview) await sql`CREATE SCHEMA IF NOT EXISTS health_preview`;

  await sql`
    CREATE TABLE IF NOT EXISTS ${profilesTable} (
      profile_id TEXT PRIMARY KEY,
      history_json TEXT NOT NULL,
      goal_target INTEGER NOT NULL,
      updated_at TEXT NOT NULL
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS ${eventsTable} (
      id BIGSERIAL PRIMARY KEY,
      session_id TEXT NOT NULL,
      event_name TEXT NOT NULL,
      properties_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    )
  `;

  await sql`ALTER TABLE ${profilesTable} ADD COLUMN IF NOT EXISTS auth_token_hash TEXT NOT NULL DEFAULT ''`;

  const profileCountRows = await sql`SELECT COUNT(*)::int AS count FROM ${profilesTable}`;
  const eventCountRows = await sql`SELECT COUNT(*)::int AS count FROM ${eventsTable}`;
  const profileCount = Number(profileCountRows[0]?.count || 0);
  const eventCount = Number(eventCountRows[0]?.count || 0);

  if (!preview && profileCount === 0 && eventCount === 0) {
    const sqliteData = await readSqliteSeedData();

    if (sqliteData.profiles.length || sqliteData.events.length) {
      await importSqliteDataToPostgres(sql, sqliteData);
    } else {
      await importLegacyProfilesToPostgres(sql);
    }
  }

  return {
    label: 'postgres',
    async createBackup() {
      if (preview) throw new Error('Scheduled backups are only available in production.');
      await sql`CREATE SCHEMA IF NOT EXISTS health_backups`;
      await sql`CREATE TABLE IF NOT EXISTS health_backups.snapshots (
        backup_id TEXT PRIMARY KEY, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), payload JSONB NOT NULL
      )`;
      const backupId = `snapshot-${Date.now()}`;
      // Build the snapshot inside PostgreSQL; production records do not leave the database.
      await sql.transaction([
        sql`INSERT INTO health_backups.snapshots (backup_id, payload)
          SELECT ${backupId}, jsonb_build_object(
            'syncedProfiles', COALESCE((SELECT jsonb_agg(jsonb_build_object(
              'profileId', profile_id, 'authTokenHash', auth_token_hash,
              'history', history_json::jsonb, 'goalTarget', goal_target, 'updatedAt', updated_at
            )) FROM public.synced_profiles), '[]'::jsonb),
            'analyticsEvents', COALESCE((SELECT jsonb_agg(jsonb_build_object(
              'sessionId', session_id, 'eventName', event_name,
              'properties', properties_json::jsonb, 'createdAt', created_at
            )) FROM public.analytics_events), '[]'::jsonb)
          )`,
        sql`DELETE FROM health_backups.snapshots WHERE created_at < NOW() - INTERVAL '7 days'`
      ], { isolationLevel: 'RepeatableRead' });
      return { backupId, retentionDays: 7 };
    },
    async getBackup(backupId) {
      if (preview) return null;
      const rows = await sql`SELECT payload FROM health_backups.snapshots WHERE backup_id = ${backupId}`;
      return rows[0]?.payload || null;
    },
    async listBackups() {
      if (preview) return [];
      await sql`CREATE SCHEMA IF NOT EXISTS health_backups`;
      await sql`CREATE TABLE IF NOT EXISTS health_backups.snapshots (
        backup_id TEXT PRIMARY KEY, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), payload JSONB NOT NULL
      )`;
      return sql`SELECT backup_id AS "backupId", created_at AS "createdAt" FROM health_backups.snapshots ORDER BY created_at DESC LIMIT 100`;
    },
    async createSyncedProfile(profileId, authTokenHash) {
      await sql`INSERT INTO ${profilesTable} (profile_id, history_json, goal_target, updated_at, auth_token_hash)
        VALUES (${profileId}, '[]', 85, ${new Date().toISOString()}, ${authTokenHash})`;
    },
    async deleteSyncedProfile(profileId) {
      await sql`DELETE FROM ${profilesTable} WHERE profile_id = ${profileId}`;
    },
    async saveSyncedProfile(profileId, history, goalTarget) {
      const updatedAt = new Date().toISOString();

      await sql`
        INSERT INTO ${profilesTable} (
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
        SELECT history_json, goal_target, updated_at, auth_token_hash
        FROM ${profilesTable}
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
        updatedAt: String(row.updated_at || ''),
        authTokenHash: String(row.auth_token_hash || '')
      };
    },
    async saveAnalyticsEvent(sessionId, eventName, properties) {
      const createdAt = new Date().toISOString();

      await sql`
        INSERT INTO ${eventsTable} (
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
        FROM ${eventsTable}
        ORDER BY created_at DESC
      `;

      return buildAnalyticsSummary(rows);
    },
    async exportAdminData() {
      const analyticsRows = await sql`
        SELECT session_id, event_name, properties_json, created_at
        FROM ${eventsTable}
        ORDER BY created_at DESC
      `;

      const profileRows = await sql`
        SELECT profile_id, history_json, goal_target, updated_at, auth_token_hash
        FROM ${profilesTable}
        ORDER BY updated_at DESC
      `;

      return {
        storage: 'postgres',
        generatedAt: new Date().toISOString(),
        analyticsSummary: buildAnalyticsSummary(analyticsRows),
        analyticsEvents: analyticsRows.map(normalizeExportedEvent),
        syncedProfiles: profileRows.map(normalizeExportedProfile)
      };
    },
    async restoreAdminData(payload) {
      const normalizedPayload = normalizeRestorePayload(payload);

      const profileQueries = normalizedPayload.syncedProfiles.map((profile) => sql`
        INSERT INTO ${profilesTable} (
          profile_id,
          history_json,
          goal_target,
          updated_at, auth_token_hash
        ) VALUES (
          ${profile.profileId},
          ${JSON.stringify(profile.history)},
          ${profile.goalTarget},
          ${profile.updatedAt},
          ${profile.authTokenHash}
        )
      `);

      const eventQueries = normalizedPayload.analyticsEvents.map((event) => sql`
        INSERT INTO ${eventsTable} (
          session_id,
          event_name,
          properties_json,
          created_at
        ) VALUES (
          ${event.sessionId},
          ${event.eventName},
          ${JSON.stringify(event.properties)},
          ${event.createdAt}
        )
      `);

      await sql.transaction([
        sql`DELETE FROM ${eventsTable}`,
        sql`DELETE FROM ${profilesTable}`,
        ...profileQueries,
        ...eventQueries
      ]);

      return {
        restoredProfiles: normalizedPayload.syncedProfiles.length,
        restoredAnalyticsEvents: normalizedPayload.analyticsEvents.length
      };
    }
  };
}

async function createStorage() {
  if (process.env.DATABASE_URL) {
    return createPostgresStorage();
  }

  if (!DatabaseSync || process.env.STORAGE_DRIVER === 'json') {
    console.warn(
      'Using JSON fallback storage (SQLite unavailable or STORAGE_DRIVER=json).'
    );
    return createJsonStorage();
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
