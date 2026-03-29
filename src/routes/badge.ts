/**
 * PhotoQRbag Badge Routes
 * Copy + Extend จาก 3ActsBooth register.ts
 * เพิ่ม: walk-in, selfie, badge print, stats
 */

import express, { Request, Response } from 'express';
import { nanoid } from 'nanoid';
import path from 'path';
import fs from 'fs';
import {
  getDatabase, getBadgeConfig, saveBadgeConfig,
  createBadgeUser, getBadgeUserByToken, getBadgeUserByLineId, getBadgeUserByEmail,
  updateBadgeUser, listBadgeUsers, getBadgeStats, getUserSessions,
} from '../db/database';
import * as lineOAuth from '../services/line-oauth';
import * as otpEmail from '../services/otp-email';
import { requireApiKey } from '../middleware/api-key';
import { CONFIG } from '../config';

const router = express.Router();

// ─── LINE Login: generate auth URL ───
router.post('/register/line-auth-url', (req: Request, res: Response) => {
  try {
    const { eventId } = req.body as { eventId: string };
    const config = getBadgeConfig(eventId);
    const channelId = (config.lineChannelId as string) || CONFIG.BADGE_LINE_CHANNEL_ID;
    const redirectUri = (config.lineCallbackUrl as string) || `${req.protocol}://${req.get('host')}/api/badge/register/line-callback`;
    if (!channelId) { res.status(400).json({ success: false, error: 'LINE Login not configured' }); return; }

    const state = `${eventId}__${nanoid(8)}`;
    const url = lineOAuth.getAuthUrl(channelId, redirectUri, state);
    res.json({ success: true, data: { url, state } });
  } catch (err) { res.status(500).json({ success: false, error: String(err) }); }
});

// ─── LINE Login: callback ───
router.get('/register/line-callback', async (req: Request, res: Response) => {
  try {
    const { code, state } = req.query as { code: string; state: string };
    const [eventId] = (state || '').split('__');
    if (!code || !eventId) { res.status(400).send('Missing code or state'); return; }

    const config = getBadgeConfig(eventId);
    const channelId = (config.lineChannelId as string) || CONFIG.BADGE_LINE_CHANNEL_ID;
    const channelSecret = (config.lineChannelSecret as string) || CONFIG.BADGE_LINE_CHANNEL_SECRET;
    const redirectUri = (config.lineCallbackUrl as string) || `${req.protocol}://${req.get('host')}/api/badge/register/line-callback`;

    const tokenRes = await lineOAuth.exchangeToken(code, channelId, channelSecret, redirectUri);
    const profile = await lineOAuth.getProfile(tokenRes.access_token);

    const existing = getBadgeUserByLineId(profile.userId, eventId);

    let personalToken: string;

    if (existing) {
      personalToken = existing.personal_qr_token;
      updateBadgeUser(existing.id, {
        line_display_name: profile.displayName,
        line_picture_url: profile.pictureUrl,
        checked_in_at: new Date().toISOString(),
      });
    } else {
      const userId = nanoid();
      personalToken = nanoid(10);
      createBadgeUser({
        id: userId,
        event_id: eventId,
        method: 'line',
        line_user_id: profile.userId,
        line_display_name: profile.displayName,
        line_picture_url: profile.pictureUrl,
        personal_qr_token: personalToken,
      });
    }

    res.redirect(`/register/?token=${personalToken}&registered=1`);
  } catch (err) { res.status(500).json({ success: false, error: String(err) }); }
});

// ─── Email OTP: send code ───
router.post('/register/email-send-otp', async (req: Request, res: Response) => {
  try {
    const { email, eventId } = req.body as { email: string; eventId: string };
    if (!email) { res.status(400).json({ success: false, error: 'Email required' }); return; }

    const config = getBadgeConfig(eventId);
    const eventRow = getDatabase().prepare('SELECT name FROM events WHERE id = ?').get(eventId) as { name: string } | undefined;
    const eventName = eventRow?.name || 'Photo Booth';

    const smtpConfig = (config.smtpUser || CONFIG.SMTP_USER) ? {
      host: (config.smtpHost as string) || CONFIG.SMTP_HOST,
      port: (config.smtpPort as number) || CONFIG.SMTP_PORT,
      user: (config.smtpUser as string) || CONFIG.SMTP_USER,
      pass: (config.smtpPass as string) || CONFIG.SMTP_PASS,
      from: (config.smtpFrom as string) || CONFIG.SMTP_USER,
    } : undefined;

    const result = await otpEmail.sendOTP(email, eventName, smtpConfig);
    res.json({ success: true, data: { sent: result.sent } });
  } catch (err) { res.status(500).json({ success: false, error: String(err) }); }
});

// ─── Email OTP: verify code + create user ───
router.post('/register/email-verify-otp', (req: Request, res: Response) => {
  try {
    const { email, code, eventId, name, phone } = req.body as { email: string; code: string; eventId: string; name?: string; phone?: string };
    if (!email || !code || !eventId) { res.status(400).json({ success: false, error: 'Missing fields' }); return; }

    const valid = otpEmail.verifyOTP(email, code);
    if (!valid) { res.status(400).json({ success: false, error: 'Invalid or expired OTP' }); return; }

    const existing = getBadgeUserByEmail(email, eventId);

    let userId: string;
    let personalToken: string;

    if (existing) {
      userId = existing.id;
      personalToken = existing.personal_qr_token;
      updateBadgeUser(userId, {
        email_verified: 1,
        name: name || undefined,
        phone: phone || undefined,
        checked_in_at: new Date().toISOString(),
      });
    } else {
      userId = nanoid();
      personalToken = nanoid(10);
      createBadgeUser({
        id: userId,
        event_id: eventId,
        method: 'email',
        email: email.toLowerCase(),
        name,
        phone,
        personal_qr_token: personalToken,
      });
      // Mark email as verified
      updateBadgeUser(userId, { email_verified: 1 });
    }

    res.json({ success: true, data: { userId, personalToken } });
  } catch (err) { res.status(500).json({ success: false, error: String(err) }); }
});

// ─── Walk-in: quick register (name only, no verification) ───
router.post('/register/walk-in', (req: Request, res: Response) => {
  try {
    const { name, eventId, phone } = req.body as { name: string; eventId: string; phone?: string };
    if (!name || !eventId) { res.status(400).json({ success: false, error: 'Name and eventId required' }); return; }

    const userId = nanoid();
    const personalToken = nanoid(10);

    createBadgeUser({
      id: userId,
      event_id: eventId,
      method: 'walk-in',
      name,
      phone,
      personal_qr_token: personalToken,
    });

    res.json({ success: true, data: { userId, personalToken } });
  } catch (err) { res.status(500).json({ success: false, error: String(err) }); }
});

// ─── Selfie upload ───
router.post('/register/selfie', (req: Request, res: Response) => {
  try {
    const { token, imageBase64 } = req.body as { token: string; imageBase64: string };
    if (!token || !imageBase64) { res.status(400).json({ success: false, error: 'token and imageBase64 required' }); return; }

    const user = getBadgeUserByToken(token);
    if (!user) { res.status(404).json({ success: false, error: 'User not found' }); return; }

    // Save selfie to storage
    const selfieDir = path.join(CONFIG.STORAGE_PATH, 'selfies');
    if (!fs.existsSync(selfieDir)) fs.mkdirSync(selfieDir, { recursive: true });

    const selfiePath = path.join(selfieDir, `${user.id}.jpg`);
    const buffer = Buffer.from(imageBase64.replace(/^data:image\/\w+;base64,/, ''), 'base64');
    fs.writeFileSync(selfiePath, buffer);

    updateBadgeUser(user.id, { selfie_path: selfiePath });
    res.json({ success: true, data: { selfiePath } });
  } catch (err) { res.status(500).json({ success: false, error: String(err) }); }
});

// ─── Personal page data ───
router.get('/personal/:token', (req: Request, res: Response) => {
  try {
    const token = req.params['token'] as string;
    const user = getBadgeUserByToken(token);
    if (!user) { res.status(404).json({ success: false, error: 'User not found' }); return; }

    const sessions = getUserSessions(token);

    // Lucky draw status
    const db = getDatabase();
    const won = db.prepare('SELECT round_name, prize_name FROM lucky_draw_rounds WHERE winner_user_id = ? AND event_id = ?')
      .get(user.id, user.event_id) as { round_name: string; prize_name: string } | undefined;

    res.json({
      success: true,
      data: {
        user: {
          id: user.id,
          name: user.name || user.line_display_name,
          picture: user.line_picture_url || (user.selfie_path ? `/api/badge/selfie/${user.id}` : null),
          email: user.email,
          method: user.method,
          checkedInAt: user.checked_in_at,
          personalQrToken: user.personal_qr_token,
          eventId: user.event_id,
        },
        sessions: sessions.map((s: any) => ({
          sessionId: s.session_id,
          photoPath: s.rendered_image_path,
          photoQrPath: s.photo_qr_path,
          clipPath: s.clip_path,
          downloadUrl: s.download_url,
          qrToken: s.qr_token,
          seriesId: s.series_id,
          delivered: !!s.delivered,
          addedAt: s.scanned_at,
        })),
        luckyDraw: won ? { won: true, prize: won.prize_name, round: won.round_name } : { won: false },
      },
    });
  } catch (err) { res.status(500).json({ success: false, error: String(err) }); }
});

// ─── Serve selfie image ───
router.get('/selfie/:userId', (req: Request, res: Response) => {
  const selfiePath = path.join(CONFIG.STORAGE_PATH, 'selfies', `${req.params['userId']}.jpg`);
  if (!fs.existsSync(selfiePath)) { res.status(404).json({ error: 'Not found' }); return; }
  res.sendFile(selfiePath);
});

// ─── Badge print image ───
router.get('/print/:token', async (req: Request, res: Response) => {
  try {
    const user = getBadgeUserByToken(req.params['token'] as string);
    if (!user) { res.status(404).json({ error: 'User not found' }); return; }

    const { generateBadgeImage } = require('../services/badge-printer');
    const buffer = await generateBadgeImage({
      name: user.name || user.line_display_name || 'Guest',
      token: user.personal_qr_token,
      eventId: user.event_id,
      selfiePath: user.selfie_path,
    });

    updateBadgeUser(user.id, { badge_printed: 1 });
    res.type('image/png').send(buffer);
  } catch (err) { res.status(500).json({ success: false, error: String(err) }); }
});

// ─── Add photo manually (via QR token from booth screen) ───
router.post('/add-photo/:personalToken', (req: Request, res: Response) => {
  try {
    const { qrToken } = req.body as { qrToken: string };
    const user = getBadgeUserByToken(req.params['personalToken'] as string);
    if (!user) { res.status(404).json({ success: false, error: 'User not found' }); return; }

    const db = getDatabase();
    const delivery = db.prepare('SELECT session_id FROM qr_deliveries WHERE id = ?').get(qrToken) as { session_id: string } | undefined;
    if (!delivery) { res.status(404).json({ success: false, error: 'QR not found' }); return; }

    // Check duplicate
    const exists = db.prepare('SELECT id FROM session_badges WHERE session_id = ? AND badge_token = ?').get(delivery.session_id, user.personal_qr_token);
    if (exists) { res.json({ success: true, data: { message: 'Already added' } }); return; }

    db.prepare('INSERT INTO session_badges (id, session_id, badge_token, delivered) VALUES (?, ?, ?, 1)')
      .run(nanoid(), delivery.session_id, user.personal_qr_token);

    res.json({ success: true, data: { message: 'Photo added' } });
  } catch (err) { res.status(500).json({ success: false, error: String(err) }); }
});

// ─── Admin routes (require API key) ─────────────────────

// Admin: list users
router.get('/users/:eventId', requireApiKey, (req: Request, res: Response) => {
  try {
    const users = listBadgeUsers(req.params['eventId'] as string);
    const total = users.length;
    const lineCount = users.filter((u: any) => u.method === 'line').length;
    const emailCount = users.filter((u: any) => u.method === 'email').length;
    const walkInCount = users.filter((u: any) => u.method === 'walk-in').length;

    res.json({ success: true, data: { total, lineCount, emailCount, walkInCount, users } });
  } catch (err) { res.status(500).json({ success: false, error: String(err) }); }
});

// Admin: stats
router.get('/stats/:eventId', requireApiKey, (req: Request, res: Response) => {
  try {
    const stats = getBadgeStats(req.params['eventId'] as string);
    res.json({ success: true, data: stats });
  } catch (err) { res.status(500).json({ success: false, error: String(err) }); }
});

// Admin: Lucky Draw
router.post('/lucky-draw/:eventId', requireApiKey, (req: Request, res: Response) => {
  try {
    const { roundName, prizeName, excludeWinners } = req.body as { roundName?: string; prizeName?: string; excludeWinners?: boolean };
    const db = getDatabase();
    const eventId = req.params['eventId'] as string;

    let query = 'SELECT id, name, line_display_name, line_picture_url, email FROM register_users WHERE event_id = ? AND checked_in_at IS NOT NULL';
    if (excludeWinners) {
      query += ' AND id NOT IN (SELECT winner_user_id FROM lucky_draw_rounds WHERE event_id = ? AND winner_user_id IS NOT NULL)';
    }
    const eligible = db.prepare(query).all(...(excludeWinners ? [eventId, eventId] : [eventId])) as any[];

    if (eligible.length === 0) { res.json({ success: true, data: { winner: null, message: 'No eligible users' } }); return; }

    const winner = eligible[Math.floor(Math.random() * eligible.length)]!;
    const roundId = nanoid();
    const now = new Date().toISOString();

    db.prepare('INSERT INTO lucky_draw_rounds (id, event_id, round_name, prize_name, winner_user_id, drawn_at, created_at) VALUES (?,?,?,?,?,?,?)')
      .run(roundId, eventId, roundName || `Round ${Date.now()}`, prizeName || 'Prize', winner.id, now, now);

    res.json({
      success: true,
      data: {
        roundId,
        winner: { id: winner.id, name: winner.name || winner.line_display_name, picture: winner.line_picture_url, email: winner.email },
      },
    });
  } catch (err) { res.status(500).json({ success: false, error: String(err) }); }
});

// Admin: Lucky Draw history
router.get('/lucky-draw/:eventId', requireApiKey, (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const rounds = db.prepare(`
      SELECT lr.*, ru.name, ru.line_display_name, ru.line_picture_url, ru.email
      FROM lucky_draw_rounds lr
      LEFT JOIN register_users ru ON ru.id = lr.winner_user_id
      WHERE lr.event_id = ?
      ORDER BY lr.drawn_at DESC
    `).all(req.params['eventId'] as string);
    res.json({ success: true, data: rounds });
  } catch (err) { res.status(500).json({ success: false, error: String(err) }); }
});

// Admin: Badge config
router.get('/config/:eventId', requireApiKey, (req: Request, res: Response) => {
  try {
    const config = getBadgeConfig(req.params['eventId'] as string);
    res.json({ success: true, data: config });
  } catch (err) { res.status(500).json({ success: false, error: String(err) }); }
});

router.put('/config/:eventId', requireApiKey, (req: Request, res: Response) => {
  try {
    saveBadgeConfig(req.params['eventId'] as string, req.body);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ success: false, error: String(err) }); }
});

export default router;
