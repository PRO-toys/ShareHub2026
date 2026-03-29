import path from 'path';

export const CONFIG = {
  /** HTTP port (avoid 3100 = Booth) */
  PORT: Number(process.env.PORT) || 3200,
  /** HTTPS port */
  HTTPS_PORT: Number(process.env.HTTPS_PORT) || 3543,

  /** Path to Booth project folder (contains BackUp/Series/) */
  WATCH_FOLDER: process.env.WATCH_FOLDER || '',

  /** Firebase service account JSON path */
  FIREBASE_KEY: process.env.FIREBASE_KEY || '',
  /** Firebase project ID */
  FIREBASE_PROJECT_ID: process.env.FIREBASE_PROJECT_ID || 'photobooth-3a08f',
  /** Firebase storage bucket */
  FIREBASE_BUCKET: process.env.FIREBASE_BUCKET || 'photobooth-3a08f.firebasestorage.app',

  /** Cloud base URL for QR codes */
  QR_BASE_URL: process.env.QR_BASE_URL || 'https://photobooth-3a08f.web.app',
  /** QR token length */
  QR_TOKEN_LENGTH: Number(process.env.QR_TOKEN_LENGTH) || 12,
  /** QR expiry hours */
  QR_EXPIRY_HOURS: Number(process.env.QR_EXPIRY_HOURS) || 24,

  /** InsightFace service URL (runs on separate machine or same) */
  FACE_SERVICE_URL: process.env.FACE_SERVICE_URL || 'http://localhost:3101',

  /** CORS origins (comma separated, empty = allow all) */
  CORS_ORIGINS: process.env.CORS_ORIGINS || '',

  /** Storage path for DB + QR images */
  STORAGE_PATH: process.env.STORAGE_PATH || path.join(process.cwd(), 'storage'),

  // ─── PhotoQRbag Config ────────────────────────────────
  /** Admin API key for protected routes */
  ADMIN_API_KEY: process.env.ADMIN_API_KEY || 'sharehub-2026-key',

  /** LINE Channel credentials (default, can override per-event via badge_config) */
  BADGE_LINE_CHANNEL_ID: process.env.BADGE_LINE_CHANNEL_ID || '',
  BADGE_LINE_CHANNEL_SECRET: process.env.BADGE_LINE_CHANNEL_SECRET || '',

  /** LINE Messaging API token (for push notifications) */
  LINE_MESSAGING_TOKEN: process.env.LINE_MESSAGING_TOKEN || '',

  /** SMTP config for OTP emails */
  SMTP_HOST: process.env.SMTP_HOST || 'smtp.gmail.com',
  SMTP_PORT: Number(process.env.SMTP_PORT) || 587,
  SMTP_USER: process.env.SMTP_USER || '',
  SMTP_PASS: process.env.SMTP_PASS || '',
};
