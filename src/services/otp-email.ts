/**
 * OTP Email Service
 * Sends 6-digit OTP via SMTP (Gmail compatible)
 * Free: Gmail SMTP allows 500 emails/day
 */

import { createTransport, Transporter } from 'nodemailer';
import { getDatabase } from '../db/database';
import { nanoid } from 'nanoid';

let transporter: Transporter | null = null;

interface SMTPConfig {
  host: string;
  port: number;
  user: string;
  pass: string;
  from: string;
}

/**
 * Initialize SMTP transporter
 */
export function initSMTP(config: SMTPConfig): void {
  transporter = createTransport({
    host: config.host || 'smtp.gmail.com',
    port: config.port || 587,
    secure: false,
    auth: {
      user: config.user,
      pass: config.pass,
    },
  });
  console.log(`[OTP] SMTP initialized: ${config.host}:${config.port}`);
}

/**
 * Generate 6-digit OTP code
 */
function generateOTP(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

/**
 * Send OTP to email address
 * Returns OTP record ID
 */
export async function sendOTP(email: string, eventName: string, smtpConfig?: SMTPConfig): Promise<{ id: string; sent: boolean }> {
  const db = getDatabase();
  const code = generateOTP();
  const id = nanoid();
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString(); // 5 min
  const now = new Date().toISOString();

  // Save to DB
  db.prepare(`INSERT INTO otp_codes (id, email, code, expires_at, created_at) VALUES (?, ?, ?, ?, ?)`)
    .run(id, email.toLowerCase().trim(), code, expiresAt, now);

  // Send email
  if (!transporter && smtpConfig) initSMTP(smtpConfig);
  if (!transporter) {
    console.warn('[OTP] No SMTP configured — OTP saved but not sent');
    return { id, sent: false };
  }

  try {
    await transporter.sendMail({
      from: smtpConfig?.from || '"PhotoQRbag" <noreply@photobooth.app>',
      to: email,
      subject: `${eventName} — Your verification code: ${code}`,
      html: `
        <div style="font-family:Inter,system-ui,sans-serif;max-width:400px;margin:0 auto;padding:24px">
          <h2 style="color:#C9A24A;font-size:20px;margin-bottom:8px">${eventName}</h2>
          <p style="color:#666;font-size:14px">Your verification code:</p>
          <div style="background:#F5F0E6;border-radius:12px;padding:20px;text-align:center;margin:16px 0">
            <span style="font-size:36px;font-weight:800;letter-spacing:0.3em;color:#1A1A1A">${code}</span>
          </div>
          <p style="color:#999;font-size:12px">This code expires in 5 minutes.</p>
          <p style="color:#999;font-size:11px;margin-top:16px">PhotoQRbag by ShareHub2026</p>
        </div>
      `,
    });
    return { id, sent: true };
  } catch (err) {
    console.error('[OTP] Failed to send email:', err);
    return { id, sent: false };
  }
}

/**
 * Verify OTP code
 * Returns true if valid + not expired
 */
export function verifyOTP(email: string, code: string): boolean {
  const db = getDatabase();
  const row = db.prepare(
    `SELECT id, code, expires_at, verified FROM otp_codes WHERE email = ? AND code = ? AND verified = 0 ORDER BY created_at DESC LIMIT 1`
  ).get(email.toLowerCase().trim(), code) as { id: string; code: string; expires_at: string; verified: number } | undefined;

  if (!row) return false;
  if (new Date(row.expires_at) < new Date()) return false;

  // Mark as verified
  db.prepare(`UPDATE otp_codes SET verified = 1 WHERE id = ?`).run(row.id);
  return true;
}
