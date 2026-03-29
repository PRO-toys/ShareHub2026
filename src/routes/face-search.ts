import { Router, Request, Response } from 'express';
import { checkFaceServiceHealth, searchByFace, indexPhotos, storeUploadResult, getUploadResult } from '../services/face-service';
import { listSessions } from '../db/database';

const { nanoid } = require('nanoid') as { nanoid: (size?: number) => string };

const router = Router();

/** GET /api/face/health — Check InsightFace service status */
router.get('/health', async (_req: Request, res: Response) => {
  const ok = await checkFaceServiceHealth();
  res.json({ status: ok ? 'online' : 'offline' });
});

/** POST /api/face/upload — Mobile selfie upload for face search */
router.post('/upload', async (req: Request, res: Response) => {
  try {
    const { token, eventId, imageBase64 } = req.body;
    if (!imageBase64) return res.status(400).json({ error: 'imageBase64 required' });

    const searchToken = token || nanoid(12);

    // Search via InsightFace
    const sessionIds = await searchByFace(imageBase64, eventId);
    storeUploadResult(searchToken, sessionIds);

    res.json({ token: searchToken, matches: sessionIds.length });
  } catch (err: any) {
    console.error('[FaceSearch] Upload error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/** GET /api/face/result — Poll for face search results */
router.get('/result', (req: Request, res: Response) => {
  const token = req.query.token as string;
  if (!token) return res.status(400).json({ error: 'token required' });

  const result = getUploadResult(token);
  if (!result) return res.json({ status: 'pending' });

  res.json({
    status: 'done',
    sessionIds: result.sessionIds || [],
    matches: (result.sessionIds || []).length,
  });
});

/** POST /api/face/index — Trigger face indexing for event */
router.post('/index', async (req: Request, res: Response) => {
  try {
    const { eventId } = req.body;
    const sessions = listSessions(eventId, 10000);

    const photos = sessions
      .filter((s: any) => s.photo_qr_path || s.rendered_image_path)
      .map((s: any) => ({
        path: s.rendered_image_path || s.photo_qr_path,
        sessionId: s.id,
        eventId: s.event_id || eventId || 'default',
      }));

    const result = await indexPhotos(photos);
    res.json({ ok: true, indexed: result.indexed, total: photos.length });
  } catch (err: any) {
    console.error('[FaceSearch] Index error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

export default router;
