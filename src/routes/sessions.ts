import { Router, Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import { listSessions, getSession, searchSessionsByCode, searchSessionsByTime, getQRDelivery } from '../db/database';
import { CONFIG } from '../config';

const router = Router();

/** GET /api/sessions — List sessions (with optional event filter) */
router.get('/', (req: Request, res: Response) => {
  const eventId = req.query.eventId as string | undefined;
  const limit = Math.min(Number(req.query.limit) || 100, 500);
  const offset = Number(req.query.offset) || 0;

  const sessions = listSessions(eventId, limit, offset);

  // Enrich with QR info
  const enriched = sessions.map((s: any) => ({
    ...s,
    photoUrl: s.photo_qr_path ? `/api/photo-preview?path=${encodeURIComponent(s.photo_qr_path)}` : null,
    clipUrl: s.clip_path ? `/api/clip-preview?path=${encodeURIComponent(s.clip_path)}` : null,
  }));

  res.json(enriched);
});

/** GET /api/sessions/search — Search by code or time range */
router.get('/search', (req: Request, res: Response) => {
  const { code, start, end, eventId } = req.query as Record<string, string>;

  let results: any[];

  if (code) {
    results = searchSessionsByCode(code, eventId);
  } else if (start && end) {
    results = searchSessionsByTime(start, end, eventId);
  } else {
    return res.status(400).json({ error: 'Provide code or start+end params' });
  }

  const enriched = results.map((s: any) => ({
    ...s,
    photoUrl: s.photo_qr_path ? `/api/photo-preview?path=${encodeURIComponent(s.photo_qr_path)}` : null,
    clipUrl: s.clip_path ? `/api/clip-preview?path=${encodeURIComponent(s.clip_path)}` : null,
  }));

  res.json(enriched);
});

/** GET /api/sessions/:id — Session detail */
router.get('/:id', (req: Request, res: Response) => {
  const session = getSession(req.params.id as string);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  res.json(session);
});

/** GET /api/photo-preview — Serve photo file with optional resize */
router.get('/photo-preview', (req: Request, res: Response) => {
  // This is mounted at app level, not under /api/sessions
  const filePath = req.query.path as string;
  if (!filePath) return res.status(400).json({ error: 'path required' });

  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved)) return res.status(404).json({ error: 'File not found' });

  // Optional resize for thumbnails
  const w = parseInt(req.query.w as string, 10);
  if (w && w > 0 && w <= 1920) {
    try {
      const sharp = require('sharp') as typeof import('sharp');
      (sharp as any)(resolved)
        .resize(w, undefined, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 75 })
        .toBuffer()
        .then((buf: Buffer) => { res.type('image/jpeg').send(buf); })
        .catch(() => { res.sendFile(resolved); });
      return;
    } catch {
      // sharp not available, serve original
    }
  }

  res.sendFile(resolved);
});

/** GET /api/clip-preview — Serve clip file */
router.get('/clip-preview', (req: Request, res: Response) => {
  const filePath = req.query.path as string;
  if (!filePath) return res.status(400).json({ error: 'path required' });

  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved)) return res.status(404).json({ error: 'File not found' });

  res.sendFile(resolved);
});

export default router;
