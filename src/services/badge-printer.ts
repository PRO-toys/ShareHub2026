/**
 * Badge Printer Service
 * Generates badge image (PNG) using sharp
 * Size: 1016 × 638px (86mm × 54mm @ 300dpi — business card)
 */

import path from 'path';
import fs from 'fs';
import { CONFIG } from '../config';
import { getEvent } from '../db/database';

interface BadgeOptions {
  name: string;
  token: string;
  eventId: string;
  selfiePath?: string;
}

/**
 * Generate badge image as PNG buffer
 * Layout: Left 30% = selfie/placeholder, Right 70% = name + event info + QR
 */
export async function generateBadgeImage(opts: BadgeOptions): Promise<Buffer> {
  const sharp = require('sharp') as typeof import('sharp');
  const QRCode = require('qrcode');

  const W = 1016;
  const H = 638;
  const SELFIE_W = Math.round(W * 0.3);

  // Get event info
  const event = getEvent(opts.eventId);
  const eventName = event?.name || 'Photo Booth Event';

  // Generate QR code
  const personalUrl = `${CONFIG.QR_BASE_URL}/personal/?token=${opts.token}`;
  const qrBuffer = await QRCode.toBuffer(personalUrl, {
    width: 200,
    margin: 1,
    color: { dark: '#1a1a2e', light: '#FFFFFF' },
  });
  const qrResized = await (sharp as any)(qrBuffer).resize(180, 180).png().toBuffer();

  // Create base canvas (white background with gold accent bar)
  const svgBase = `
    <svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
      <rect width="${W}" height="${H}" fill="#FFFFFF"/>
      <rect x="0" y="0" width="${SELFIE_W}" height="${H}" fill="#F5F0E6"/>
      <rect x="0" y="${H - 6}" width="${W}" height="6" fill="#C9A24A"/>
      <text x="${SELFIE_W + 40}" y="80" font-family="Arial,sans-serif" font-size="36" font-weight="bold" fill="#1a1a2e">${escapeXml(opts.name)}</text>
      <text x="${SELFIE_W + 40}" y="120" font-family="Arial,sans-serif" font-size="20" fill="#666666">${escapeXml(eventName)}</text>
      <text x="${SELFIE_W + 40}" y="155" font-family="Arial,sans-serif" font-size="14" fill="#999999">PhotoQRbag</text>
      <text x="${SELFIE_W + 40}" y="${H - 30}" font-family="Arial,sans-serif" font-size="11" fill="#BBBBBB">Scan QR to view your photos</text>
    </svg>
  `;

  const composites: any[] = [];

  // QR code (bottom-right of right panel)
  composites.push({
    input: qrResized,
    left: W - 180 - 30,
    top: H - 180 - 40,
  });

  // Selfie or placeholder
  if (opts.selfiePath && fs.existsSync(opts.selfiePath)) {
    const selfieResized = await (sharp as any)(opts.selfiePath)
      .resize(SELFIE_W - 40, H - 80, { fit: 'cover' })
      .jpeg({ quality: 85 })
      .toBuffer();
    composites.push({
      input: selfieResized,
      left: 20,
      top: 40,
    });
  } else {
    // Placeholder icon (gray circle with person silhouette)
    const placeholderSize = Math.min(SELFIE_W - 80, H - 160);
    const px = Math.round((SELFIE_W - placeholderSize) / 2);
    const py = Math.round((H - placeholderSize) / 2);
    const placeholderSvg = Buffer.from(`
      <svg width="${placeholderSize}" height="${placeholderSize}" xmlns="http://www.w3.org/2000/svg">
        <circle cx="${placeholderSize / 2}" cy="${placeholderSize / 2}" r="${placeholderSize / 2}" fill="#E0D8C8"/>
        <circle cx="${placeholderSize / 2}" cy="${placeholderSize * 0.38}" r="${placeholderSize * 0.18}" fill="#C9B896"/>
        <ellipse cx="${placeholderSize / 2}" cy="${placeholderSize * 0.85}" rx="${placeholderSize * 0.3}" ry="${placeholderSize * 0.22}" fill="#C9B896"/>
      </svg>
    `);
    composites.push({
      input: placeholderSvg,
      left: px,
      top: py,
    });
  }

  // Compose final badge
  const badge = await (sharp as any)(Buffer.from(svgBase))
    .composite(composites)
    .png()
    .toBuffer();

  return badge;
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
