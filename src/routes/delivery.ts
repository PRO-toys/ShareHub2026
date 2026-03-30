import { Router, Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import { getQRDelivery, incrementDownloadCount, markDeliveryCompleted, trackShare, getSession, insertAnalyticsEvent } from '../db/database';
import { getLocalIpAddress } from '../services/qr-service';
import { CONFIG } from '../config';

const router = Router();

/** GET /api/delivery/page/:token — Serve session data for QR landing */
router.get('/page/:token', (req: Request, res: Response) => {
  const token = req.params.token as string;
  const delivery = getQRDelivery(token);

  if (!delivery) {
    return res.status(404).json({ error: 'Delivery not found or expired' });
  }

  const session = getSession(delivery.session_id);

  // ─── Session status check: processing → wait ───
  if (session?.status === 'processing') {
    return res.status(202).json({
      token,
      status: 'processing',
      message: 'Photos are being prepared. Please wait a moment.',
      retryAfterMs: 2000,
    });
  }

  incrementDownloadCount(token);

  const localIp = getLocalIpAddress();

  // Determine locationType based on what's available
  const hasCloud = !!(delivery.photo_qr_url || delivery.download_url?.startsWith('https://'));
  const hasLocal = !!(delivery.file_path && fs.existsSync(delivery.file_path));
  const locationType = hasCloud && hasLocal ? 'hybrid' : hasCloud ? 'cloud' : 'local';

  // Build response with both local + cloud URLs
  const response: any = {
    token,
    sessionId: delivery.session_id,
    eventId: session?.event_id || null,
    status: session?.status || 'ready',
    // Cloud URLs (for Firebase Hosting / offline-server access)
    photoUrl: delivery.photo_qr_url || delivery.download_url,
    photoQrUrl: delivery.photo_qr_url || null,
    clipUrl: delivery.clip_url || null,
    // Metadata
    themeId: 'premium-white-gold',
    locationType,
    localServerIp: localIp,
    localServerPort: CONFIG.PORT,
    createdAt: delivery.created_at,
    expiresAt: delivery.expires_at,
  };

  // Local URLs (LAN fast-path)
  if (hasLocal) {
    response.localPhotoUrl = `/api/delivery/photo/${token}`;
  }

  res.json(response);
});

/** GET /api/delivery/photo/:token — Serve actual photo file */
router.get('/photo/:token', (req: Request, res: Response) => {
  const delivery = getQRDelivery(req.params.token as string);
  if (!delivery || !delivery.file_path || !fs.existsSync(delivery.file_path)) {
    return res.status(404).json({ error: 'Photo not found' });
  }
  res.sendFile(path.resolve(delivery.file_path));
});

/** GET /api/delivery/qr/:token.png — Serve QR image */
router.get('/qr/:filename', (req: Request, res: Response) => {
  const token = (req.params.filename as string).replace('.png', '');
  const delivery = getQRDelivery(token);
  if (!delivery || !delivery.qr_image_path || !fs.existsSync(delivery.qr_image_path)) {
    return res.status(404).json({ error: 'QR not found' });
  }
  res.sendFile(path.resolve(delivery.qr_image_path));
});

/** POST /api/delivery/done — Mark delivery completed */
router.post('/done', (req: Request, res: Response) => {
  const token = req.body?.token as string;
  if (!token) return res.status(400).json({ error: 'token required' });

  const delivery = getQRDelivery(token);
  if (!delivery) return res.status(404).json({ error: 'Not found' });
  if (delivery.completed_at) return res.json({ ok: true, already: true });

  markDeliveryCompleted(token);
  res.json({ ok: true });
});

/** POST /api/delivery/share — Track share event */
router.post('/share', (req: Request, res: Response) => {
  const { token, platform } = req.body;
  if (!token || !platform) return res.status(400).json({ error: 'token + platform required' });

  const valid = ['facebook', 'line', 'twitter', 'native'] as const;
  if (!valid.includes(platform)) return res.status(400).json({ error: 'Invalid platform' });

  trackShare(token, platform);
  res.json({ ok: true });
});

/** POST /api/analytics/event — Track page view / analytics */
router.post('/analytics/event', (req: Request, res: Response) => {
  try {
    insertAnalyticsEvent(req.body);
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: 'Failed' });
  }
});

export default router;
