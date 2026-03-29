import Database from 'better-sqlite3';
import path from 'path';
import { CONFIG } from '../config';

let db: Database.Database | null = null;

export function getDatabase(): Database.Database {
  if (db) return db;

  const dbPath = path.join(CONFIG.STORAGE_PATH, 'sharehub.sqlite');
  db = new Database(dbPath);

  // Performance: WAL mode + foreign keys
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  initializeSchema(db);
  return db;
}

function initializeSchema(db: Database.Database): void {
  db.exec(`
    -- Events (minimal — just enough for grouping)
    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      date TEXT NOT NULL,
      status TEXT DEFAULT 'active',
      project_folder TEXT,
      location_type TEXT DEFAULT 'hybrid',
      cloud_config TEXT DEFAULT '{}',
      theme_id TEXT DEFAULT 'premium-white-gold',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    -- Sessions (detected from Series folders)
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      event_id TEXT,
      series_id TEXT NOT NULL,
      session_code TEXT,
      rendered_image_path TEXT,
      photo_qr_path TEXT,
      clip_path TEXT,
      act_count INTEGER DEFAULT 1,
      status TEXT DEFAULT 'completed',
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE SET NULL
    );

    -- QR Deliveries
    CREATE TABLE IF NOT EXISTS qr_deliveries (
      id TEXT PRIMARY KEY,
      session_id TEXT,
      file_path TEXT,
      download_url TEXT,
      qr_image_path TEXT,
      photo_qr_url TEXT,
      clip_url TEXT,
      expires_at TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      download_count INTEGER DEFAULT 0,
      completed_at TEXT,
      share_facebook INTEGER DEFAULT 0,
      share_line INTEGER DEFAULT 0,
      share_twitter INTEGER DEFAULT 0,
      share_native INTEGER DEFAULT 0,
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    );

    -- Face Descriptors (for face search)
    CREATE TABLE IF NOT EXISTS face_descriptors (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id TEXT,
      session_id TEXT,
      series_id TEXT,
      photo_path TEXT NOT NULL,
      descriptor_json TEXT,
      face_index INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );

    -- Analytics Events
    CREATE TABLE IF NOT EXISTS analytics_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      token TEXT,
      event_id TEXT,
      event_type TEXT NOT NULL,
      platform TEXT,
      device_type TEXT,
      os TEXT,
      browser TEXT,
      screen_width INTEGER,
      screen_height INTEGER,
      created_at TEXT DEFAULT (datetime('now'))
    );

    -- Indexes
    CREATE INDEX IF NOT EXISTS idx_sessions_event ON sessions(event_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_series ON sessions(series_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_code ON sessions(session_code);
    CREATE INDEX IF NOT EXISTS idx_qr_session ON qr_deliveries(session_id);
    CREATE INDEX IF NOT EXISTS idx_qr_expires ON qr_deliveries(expires_at);
    CREATE INDEX IF NOT EXISTS idx_face_event ON face_descriptors(event_id);
    CREATE INDEX IF NOT EXISTS idx_face_session ON face_descriptors(session_id);
    CREATE INDEX IF NOT EXISTS idx_analytics_event ON analytics_events(event_id);
    CREATE INDEX IF NOT EXISTS idx_analytics_token ON analytics_events(token);

    -- ═══ PhotoQRbag Tables ═══

    -- Registered badge users
    CREATE TABLE IF NOT EXISTS register_users (
      id TEXT PRIMARY KEY,
      event_id TEXT,
      method TEXT NOT NULL DEFAULT 'email',
      line_user_id TEXT,
      line_display_name TEXT,
      line_picture_url TEXT,
      email TEXT,
      email_verified INTEGER DEFAULT 0,
      name TEXT,
      phone TEXT,
      personal_qr_token TEXT UNIQUE,
      selfie_path TEXT,
      badge_printed INTEGER DEFAULT 0,
      checked_in_at TEXT,
      device_info TEXT,
      created_at TEXT NOT NULL
    );

    -- OTP codes for email verification
    CREATE TABLE IF NOT EXISTS otp_codes (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL,
      code TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      verified INTEGER DEFAULT 0,
      created_at TEXT NOT NULL
    );

    -- Lucky Draw rounds
    CREATE TABLE IF NOT EXISTS lucky_draw_rounds (
      id TEXT PRIMARY KEY,
      event_id TEXT NOT NULL,
      round_name TEXT DEFAULT '',
      prize_name TEXT DEFAULT '',
      winner_user_id TEXT,
      drawn_at TEXT,
      created_at TEXT NOT NULL
    );

    -- Session ↔ Badge link (auto-delivery tracking)
    CREATE TABLE IF NOT EXISTS session_badges (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      badge_token TEXT NOT NULL,
      scanned_at TEXT DEFAULT (datetime('now')),
      delivered INTEGER DEFAULT 0,
      delivered_at TEXT,
      notified INTEGER DEFAULT 0,
      retry_count INTEGER DEFAULT 0,
      last_error TEXT,
      UNIQUE(session_id, badge_token)
    );

    -- Pending badge scans (SQLite-backed, survives restart)
    CREATE TABLE IF NOT EXISTS pending_badges (
      id TEXT PRIMARY KEY,
      booth_id TEXT NOT NULL,
      batch_id TEXT NOT NULL,
      badge_token TEXT NOT NULL,
      scanned_at TEXT DEFAULT (datetime('now')),
      status TEXT DEFAULT 'pending',
      UNIQUE(batch_id, badge_token)
    );

    -- Badge config per event
    CREATE TABLE IF NOT EXISTS badge_config (
      event_id TEXT PRIMARY KEY,
      config_json TEXT NOT NULL DEFAULT '{}',
      updated_at TEXT DEFAULT (datetime('now'))
    );

    -- PhotoQRbag indexes
    CREATE INDEX IF NOT EXISTS idx_register_users_event ON register_users(event_id);
    CREATE INDEX IF NOT EXISTS idx_register_users_token ON register_users(personal_qr_token);
    CREATE INDEX IF NOT EXISTS idx_register_users_line ON register_users(line_user_id);
    CREATE INDEX IF NOT EXISTS idx_session_badges_session ON session_badges(session_id);
    CREATE INDEX IF NOT EXISTS idx_session_badges_token ON session_badges(badge_token);
    CREATE INDEX IF NOT EXISTS idx_pending_booth ON pending_badges(booth_id, status);
    CREATE INDEX IF NOT EXISTS idx_pending_batch ON pending_badges(batch_id);
    CREATE INDEX IF NOT EXISTS idx_otp_email ON otp_codes(email);
  `);
}

// ─── Helper Functions ───────────────────────────────────────

export function getEvent(id: string) {
  return getDatabase().prepare('SELECT * FROM events WHERE id = ?').get(id) as any;
}

export function listEvents() {
  return getDatabase().prepare('SELECT * FROM events ORDER BY date DESC').all() as any[];
}

export function createEvent(ev: { id: string; name: string; date: string; project_folder?: string; location_type?: string; cloud_config?: string; theme_id?: string }) {
  getDatabase().prepare(`
    INSERT INTO events (id, name, date, project_folder, location_type, cloud_config, theme_id)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(ev.id, ev.name, ev.date, ev.project_folder || '', ev.location_type || 'hybrid', ev.cloud_config || '{}', ev.theme_id || 'premium-white-gold');
}

export function updateEvent(id: string, fields: Record<string, any>) {
  const allowed = ['name', 'date', 'status', 'project_folder', 'location_type', 'cloud_config', 'theme_id'];
  const updates: string[] = [];
  const values: any[] = [];
  for (const [k, v] of Object.entries(fields)) {
    if (allowed.includes(k)) {
      updates.push(`${k} = ?`);
      values.push(v);
    }
  }
  if (updates.length === 0) return;
  updates.push("updated_at = datetime('now')");
  values.push(id);
  getDatabase().prepare(`UPDATE events SET ${updates.join(', ')} WHERE id = ?`).run(...values);
}

export function getSession(id: string) {
  return getDatabase().prepare('SELECT * FROM sessions WHERE id = ?').get(id) as any;
}

export function getSessionBySeriesId(seriesId: string) {
  return getDatabase().prepare('SELECT * FROM sessions WHERE series_id = ?').get(seriesId) as any;
}

export function listSessions(eventId?: string, limit = 100, offset = 0) {
  if (eventId) {
    return getDatabase().prepare('SELECT * FROM sessions WHERE event_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?').all(eventId, limit, offset) as any[];
  }
  return getDatabase().prepare('SELECT * FROM sessions ORDER BY created_at DESC LIMIT ? OFFSET ?').all(limit, offset) as any[];
}

export function upsertSession(s: { id: string; event_id?: string; series_id: string; session_code?: string; rendered_image_path?: string; photo_qr_path?: string; clip_path?: string; act_count?: number }) {
  getDatabase().prepare(`
    INSERT INTO sessions (id, event_id, series_id, session_code, rendered_image_path, photo_qr_path, clip_path, act_count)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      photo_qr_path = COALESCE(excluded.photo_qr_path, photo_qr_path),
      clip_path = COALESCE(excluded.clip_path, clip_path),
      rendered_image_path = COALESCE(excluded.rendered_image_path, rendered_image_path)
  `).run(s.id, s.event_id || null, s.series_id, s.session_code || null, s.rendered_image_path || null, s.photo_qr_path || null, s.clip_path || null, s.act_count || 1);
}

export function searchSessionsByCode(code: string, eventId?: string) {
  if (eventId) {
    return getDatabase().prepare('SELECT * FROM sessions WHERE session_code LIKE ? AND event_id = ? ORDER BY created_at DESC').all(`%${code}%`, eventId) as any[];
  }
  return getDatabase().prepare('SELECT * FROM sessions WHERE session_code LIKE ? ORDER BY created_at DESC').all(`%${code}%`) as any[];
}

export function searchSessionsByTime(start: string, end: string, eventId?: string) {
  if (eventId) {
    return getDatabase().prepare('SELECT * FROM sessions WHERE created_at >= ? AND created_at <= ? AND event_id = ? ORDER BY created_at DESC').all(start, end, eventId) as any[];
  }
  return getDatabase().prepare('SELECT * FROM sessions WHERE created_at >= ? AND created_at <= ? ORDER BY created_at DESC').all(start, end) as any[];
}

export function getQRDelivery(token: string) {
  return getDatabase().prepare('SELECT * FROM qr_deliveries WHERE id = ?').get(token) as any;
}

export function createQRDelivery(d: { id: string; session_id: string; file_path: string; download_url: string; qr_image_path: string; photo_qr_url?: string; clip_url?: string; expires_at: string }) {
  getDatabase().prepare(`
    INSERT INTO qr_deliveries (id, session_id, file_path, download_url, qr_image_path, photo_qr_url, clip_url, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(d.id, d.session_id, d.file_path, d.download_url, d.qr_image_path, d.photo_qr_url || null, d.clip_url || null, d.expires_at);
}

export function incrementDownloadCount(token: string) {
  getDatabase().prepare('UPDATE qr_deliveries SET download_count = download_count + 1 WHERE id = ?').run(token);
}

export function markDeliveryCompleted(token: string) {
  getDatabase().prepare("UPDATE qr_deliveries SET completed_at = datetime('now') WHERE id = ?").run(token);
}

export function trackShare(token: string, platform: 'facebook' | 'line' | 'twitter' | 'native') {
  const col = `share_${platform}`;
  getDatabase().prepare(`UPDATE qr_deliveries SET ${col} = ${col} + 1 WHERE id = ?`).run(token);
}

export function insertAnalyticsEvent(ev: { token?: string; event_id?: string; event_type: string; platform?: string; device_type?: string; os?: string; browser?: string; screen_width?: number; screen_height?: number }) {
  getDatabase().prepare(`
    INSERT INTO analytics_events (token, event_id, event_type, platform, device_type, os, browser, screen_width, screen_height)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(ev.token || null, ev.event_id || null, ev.event_type, ev.platform || null, ev.device_type || null, ev.os || null, ev.browser || null, ev.screen_width || null, ev.screen_height || null);
}

// ═══ PhotoQRbag Helpers ═══════════════════════════════════

// ─── Badge Users ─────────────────────────────────────────

export function createBadgeUser(u: { id: string; event_id: string; method: string; name?: string; email?: string; phone?: string; line_user_id?: string; line_display_name?: string; line_picture_url?: string; personal_qr_token: string }) {
  getDatabase().prepare(`
    INSERT INTO register_users (id, event_id, method, name, email, phone, line_user_id, line_display_name, line_picture_url, personal_qr_token, checked_in_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(u.id, u.event_id, u.method, u.name || null, u.email || null, u.phone || null, u.line_user_id || null, u.line_display_name || null, u.line_picture_url || null, u.personal_qr_token, new Date().toISOString(), new Date().toISOString());
}

export function getBadgeUserByToken(token: string) {
  return getDatabase().prepare('SELECT * FROM register_users WHERE personal_qr_token = ?').get(token) as any;
}

export function getBadgeUserByLineId(lineUserId: string, eventId: string) {
  return getDatabase().prepare('SELECT * FROM register_users WHERE line_user_id = ? AND event_id = ?').get(lineUserId, eventId) as any;
}

export function getBadgeUserByEmail(email: string, eventId: string) {
  return getDatabase().prepare('SELECT * FROM register_users WHERE email = ? AND event_id = ?').get(email.toLowerCase(), eventId) as any;
}

export function updateBadgeUser(id: string, fields: Record<string, unknown>) {
  const allowed = ['name', 'email', 'email_verified', 'phone', 'line_display_name', 'line_picture_url', 'selfie_path', 'badge_printed', 'checked_in_at', 'device_info'];
  const updates: string[] = [];
  const values: unknown[] = [];
  for (const [k, v] of Object.entries(fields)) {
    if (allowed.includes(k)) {
      updates.push(`${k} = ?`);
      values.push(v);
    }
  }
  if (updates.length === 0) return;
  values.push(id);
  getDatabase().prepare(`UPDATE register_users SET ${updates.join(', ')} WHERE id = ?`).run(...values);
}

export function listBadgeUsers(eventId: string) {
  return getDatabase().prepare('SELECT * FROM register_users WHERE event_id = ? ORDER BY created_at DESC').all(eventId) as any[];
}

export function getBadgeStats(eventId: string) {
  const db = getDatabase();
  const total = (db.prepare('SELECT COUNT(*) as c FROM register_users WHERE event_id = ?').get(eventId) as any).c;
  const checkedIn = (db.prepare('SELECT COUNT(*) as c FROM register_users WHERE event_id = ? AND checked_in_at IS NOT NULL').get(eventId) as any).c;
  const byMethod = db.prepare('SELECT method, COUNT(*) as count FROM register_users WHERE event_id = ? GROUP BY method').all(eventId);
  const byHour = db.prepare("SELECT strftime('%H', checked_in_at) as hour, COUNT(*) as count FROM register_users WHERE event_id = ? AND checked_in_at IS NOT NULL GROUP BY hour ORDER BY hour").all(eventId);
  return { total, checkedIn, byMethod, byHour };
}

// ─── Session Badges (auto-delivery links) ────────────────

export function createSessionBadge(sessionId: string, badgeToken: string, id: string) {
  getDatabase().prepare(`
    INSERT OR IGNORE INTO session_badges (id, session_id, badge_token)
    VALUES (?, ?, ?)
  `).run(id, sessionId, badgeToken);
}

export function getSessionBadges(sessionId: string) {
  return getDatabase().prepare('SELECT * FROM session_badges WHERE session_id = ?').all(sessionId) as any[];
}

export function getUserSessions(badgeToken: string) {
  return getDatabase().prepare(`
    SELECT sb.session_id, sb.delivered, sb.delivered_at, sb.scanned_at,
           s.rendered_image_path, s.photo_qr_path, s.clip_path, s.series_id, s.session_code,
           qr.id as qr_token, qr.download_url
    FROM session_badges sb
    LEFT JOIN sessions s ON s.id = sb.session_id
    LEFT JOIN qr_deliveries qr ON qr.session_id = sb.session_id
    WHERE sb.badge_token = ?
    ORDER BY sb.scanned_at DESC
  `).all(badgeToken) as any[];
}

export function markBadgeDelivered(sessionId: string, badgeToken: string) {
  getDatabase().prepare(`
    UPDATE session_badges SET delivered = 1, delivered_at = datetime('now') WHERE session_id = ? AND badge_token = ?
  `).run(sessionId, badgeToken);
}

export function markBadgeNotified(sessionId: string, badgeToken: string) {
  getDatabase().prepare(`
    UPDATE session_badges SET notified = 1 WHERE session_id = ? AND badge_token = ?
  `).run(sessionId, badgeToken);
}

export function incrementRetryCount(sessionId: string, badgeToken: string, error: string) {
  getDatabase().prepare(`
    UPDATE session_badges SET retry_count = retry_count + 1, last_error = ? WHERE session_id = ? AND badge_token = ?
  `).run(error, sessionId, badgeToken);
}

export function getUndeliveredBadges() {
  return getDatabase().prepare(`
    SELECT sb.*, ru.line_user_id, ru.line_display_name, ru.name, ru.email
    FROM session_badges sb
    JOIN register_users ru ON ru.personal_qr_token = sb.badge_token
    WHERE sb.delivered = 0 AND sb.retry_count < 3
    ORDER BY sb.scanned_at ASC
  `).all() as any[];
}

// ─── Pending Badges (Batch system) ───────────────────────

export function createBatch(batchId: string, boothId: string) {
  // No separate batch table — batch is defined by batch_id in pending_badges
  // This is just a marker; first scan creates the batch implicitly
  return { batchId, boothId };
}

export function addToBatch(id: string, batchId: string, boothId: string, badgeToken: string): { ok: boolean; duplicate: boolean } {
  const db = getDatabase();
  const existing = db.prepare('SELECT 1 FROM pending_badges WHERE batch_id = ? AND badge_token = ?').get(batchId, badgeToken);
  if (existing) return { ok: true, duplicate: true };

  db.prepare(`INSERT INTO pending_badges (id, booth_id, batch_id, badge_token, status) VALUES (?, ?, ?, ?, 'pending')`)
    .run(id, boothId, batchId, badgeToken);
  return { ok: true, duplicate: false };
}

export function lockBatch(batchId: string) {
  getDatabase().prepare(`UPDATE pending_badges SET status = 'locked' WHERE batch_id = ? AND status = 'pending'`).run(batchId);
}

export function getLockedBatch(boothId: string) {
  return getDatabase().prepare(`
    SELECT batch_id, badge_token FROM pending_badges
    WHERE booth_id = ? AND status = 'locked'
    ORDER BY scanned_at ASC
  `).all(boothId) as { batch_id: string; badge_token: string }[];
}

export function markBatchUsed(batchId: string) {
  getDatabase().prepare(`UPDATE pending_badges SET status = 'used' WHERE batch_id = ?`).run(batchId);
}

export function getPendingBatch(boothId: string) {
  return getDatabase().prepare(`
    SELECT pb.batch_id, pb.badge_token, pb.status, pb.scanned_at,
           ru.name, ru.line_display_name, ru.email
    FROM pending_badges pb
    LEFT JOIN register_users ru ON ru.personal_qr_token = pb.badge_token
    WHERE pb.booth_id = ? AND pb.status IN ('pending', 'locked')
    ORDER BY pb.scanned_at ASC
  `).all(boothId) as any[];
}

export function cleanupExpiredBatches() {
  getDatabase().prepare(`
    UPDATE pending_badges SET status = 'expired'
    WHERE status IN ('pending', 'locked')
    AND scanned_at < datetime('now', '-15 minutes')
  `).run();
}

// ─── Badge Config ────────────────────────────────────────

export function getBadgeConfig(eventId: string): Record<string, unknown> {
  const row = getDatabase().prepare('SELECT config_json FROM badge_config WHERE event_id = ?').get(eventId) as { config_json: string } | undefined;
  try { return JSON.parse(row?.config_json ?? '{}'); } catch { return {}; }
}

export function saveBadgeConfig(eventId: string, config: Record<string, unknown>) {
  getDatabase().prepare(`
    INSERT INTO badge_config (event_id, config_json, updated_at) VALUES (?, ?, datetime('now'))
    ON CONFLICT(event_id) DO UPDATE SET config_json = excluded.config_json, updated_at = datetime('now')
  `).run(eventId, JSON.stringify(config));
}
