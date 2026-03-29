import path from 'path';
import fs from 'fs';
import os from 'os';
import QRCode from 'qrcode';
import { CONFIG } from '../config';
import { createQRDelivery as dbCreateQR, getQRDelivery } from '../db/database';

// Use nanoid v3 (CommonJS)
const { nanoid } = require('nanoid') as { nanoid: (size?: number) => string };

export function getLocalIpAddress(): string {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family === 'IPv4' && !net.internal) {
        return net.address;
      }
    }
  }
  return '127.0.0.1';
}

export interface DeliveryResult {
  token: string;
  downloadUrl: string;
  localDownloadUrl: string;
  qrImagePath: string;
}

export async function createDeliveryForSession(
  sessionId: string,
  photoPath: string,
  clipPath?: string,
): Promise<DeliveryResult | null> {
  try {
    const token = nanoid(CONFIG.QR_TOKEN_LENGTH);
    const localIp = getLocalIpAddress();

    // URLs
    const cloudUrl = `${CONFIG.QR_BASE_URL}/download/${token}`;
    const localUrl = `http://${localIp}:${CONFIG.PORT}/api/delivery/page/${token}`;

    // Generate QR image (cloud URL for permanence)
    const qrDir = path.join(CONFIG.STORAGE_PATH, 'qr');
    if (!fs.existsSync(qrDir)) fs.mkdirSync(qrDir, { recursive: true });

    const qrImagePath = path.join(qrDir, `${token}.png`);
    await QRCode.toFile(qrImagePath, cloudUrl, {
      width: 400,
      margin: 2,
      color: { dark: '#000000', light: '#FFFFFF' },
    });

    // Expiry
    const expiresAt = new Date(Date.now() + CONFIG.QR_EXPIRY_HOURS * 60 * 60 * 1000).toISOString();

    // Save to DB
    dbCreateQR({
      id: token,
      session_id: sessionId,
      file_path: photoPath,
      download_url: cloudUrl,
      qr_image_path: qrImagePath,
      photo_qr_url: null as any,
      clip_url: clipPath || null as any,
      expires_at: expiresAt,
    });

    return {
      token,
      downloadUrl: cloudUrl,
      localDownloadUrl: localUrl,
      qrImagePath,
    };
  } catch (err: any) {
    console.error('[QR] Error creating delivery:', err.message);
    return null;
  }
}

export function getDelivery(token: string) {
  return getQRDelivery(token);
}

export { getLocalIpAddress as getServerIp };
