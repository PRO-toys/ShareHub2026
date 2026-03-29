/**
 * Booth Operator Badge Scan Routes
 * Manages batch scanning: New Batch → Scan × N → Lock → Auto-Link
 * All routes require API key
 */

import express, { Request, Response } from 'express';
import { nanoid } from 'nanoid';
import {
  addToBatch, lockBatch, getPendingBatch, markBatchUsed,
  getBadgeUserByToken,
} from '../db/database';
import { requireApiKey } from '../middleware/api-key';

const router = express.Router();

// All badge-scan routes require API key
router.use(requireApiKey);

// ─── Create new batch ───
router.post('/batch/new', (req: Request, res: Response) => {
  try {
    const { boothId } = req.body as { boothId: string };
    if (!boothId) { res.status(400).json({ success: false, error: 'boothId required' }); return; }

    const batchId = nanoid(12);
    res.json({ success: true, data: { batchId, boothId } });
  } catch (err) { res.status(500).json({ success: false, error: String(err) }); }
});

// ─── Scan badge into batch ───
router.post('/scan', (req: Request, res: Response) => {
  try {
    const { batchId, badgeToken, boothId } = req.body as { batchId: string; badgeToken: string; boothId: string };
    if (!batchId || !badgeToken || !boothId) {
      res.status(400).json({ success: false, error: 'batchId, badgeToken, and boothId required' });
      return;
    }

    // Verify badge exists
    const user = getBadgeUserByToken(badgeToken);
    if (!user) { res.status(404).json({ success: false, error: 'Badge not found — not registered' }); return; }

    const result = addToBatch(nanoid(), batchId, boothId, badgeToken);

    res.json({
      success: true,
      data: {
        ...result,
        userName: user.name || user.line_display_name || user.email || 'Guest',
      },
    });
  } catch (err) { res.status(500).json({ success: false, error: String(err) }); }
});

// ─── Lock batch (ready for capture) ───
router.post('/batch/lock/:batchId', (req: Request, res: Response) => {
  try {
    const batchId = req.params['batchId'] as string;
    lockBatch(batchId);
    res.json({ success: true, data: { batchId, status: 'locked' } });
  } catch (err) { res.status(500).json({ success: false, error: String(err) }); }
});

// ─── Get pending badges for booth ───
router.get('/pending/:boothId', (req: Request, res: Response) => {
  try {
    const badges = getPendingBatch(req.params['boothId'] as string);

    // Group by batch
    const batches = new Map<string, { batchId: string; status: string; badges: any[] }>();
    for (const b of badges) {
      if (!batches.has(b.batch_id)) {
        batches.set(b.batch_id, { batchId: b.batch_id, status: b.status, badges: [] });
      }
      batches.get(b.batch_id)!.badges.push({
        token: b.badge_token,
        name: b.name || b.line_display_name || b.email || 'Guest',
        scannedAt: b.scanned_at,
      });
    }

    res.json({ success: true, data: Array.from(batches.values()) });
  } catch (err) { res.status(500).json({ success: false, error: String(err) }); }
});

// ─── Manual link: force-link a batch to a session ───
router.post('/link', (req: Request, res: Response) => {
  try {
    const { batchId, sessionId } = req.body as { batchId: string; sessionId: string };
    if (!batchId || !sessionId) { res.status(400).json({ success: false, error: 'batchId and sessionId required' }); return; }

    const { linkBatchToSession } = require('../services/badge-delivery');
    const linked = linkBatchToSession(batchId, sessionId);

    res.json({ success: true, data: { linked } });
  } catch (err) { res.status(500).json({ success: false, error: String(err) }); }
});

export default router;
