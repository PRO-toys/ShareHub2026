/**
 * Badge Delivery Service
 * Handles: auto-link batches to sessions, retry delivery, cleanup expired
 */

import { nanoid } from 'nanoid';
import {
  getDatabase, getLockedBatch, markBatchUsed,
  createSessionBadge, markBadgeDelivered, markBadgeNotified,
  incrementRetryCount, getUndeliveredBadges, cleanupExpiredBatches,
  getBadgeUserByToken,
} from '../db/database';

/**
 * Link a locked batch to a session (called by folder-watcher)
 * Finds the oldest locked batch for any booth → creates session_badges → marks batch used
 */
export function linkPendingBadgesToSession(sessionId: string, boothId?: string): number {
  const db = getDatabase();

  // Find locked badges — if boothId provided use it, otherwise find any locked batch
  let locked: { batch_id: string; badge_token: string }[];
  if (boothId) {
    locked = getLockedBatch(boothId);
  } else {
    // Find the oldest locked batch from any booth
    locked = db.prepare(`
      SELECT batch_id, badge_token FROM pending_badges
      WHERE status = 'locked'
      ORDER BY scanned_at ASC
    `).all() as { batch_id: string; badge_token: string }[];
  }

  if (locked.length === 0) return 0;

  // Group by batch — take the first batch only (FIFO)
  const firstBatchId = locked[0].batch_id;
  const batchBadges = locked.filter(l => l.batch_id === firstBatchId);

  let linked = 0;
  for (const badge of batchBadges) {
    try {
      createSessionBadge(sessionId, badge.badge_token, nanoid());
      markBadgeDelivered(sessionId, badge.badge_token);
      linked++;
      console.log(`[Badge] Linked: ${badge.badge_token} → session ${sessionId}`);
    } catch (err: any) {
      // UNIQUE constraint = already linked, skip
      if (!err.message?.includes('UNIQUE')) {
        console.warn(`[Badge] Link failed: ${err.message}`);
      }
    }
  }

  // Mark batch as used
  markBatchUsed(firstBatchId);
  console.log(`[Badge] Batch ${firstBatchId}: ${linked} badges linked to session ${sessionId}`);

  // Queue LINE push notifications (async, non-blocking)
  notifyLinkedUsers(sessionId, batchBadges.map(b => b.badge_token))
    .catch(err => console.warn(`[Badge] Notification failed: ${err.message}`));

  return linked;
}

/**
 * Link a specific batch to a session (manual link from operator)
 */
export function linkBatchToSession(batchId: string, sessionId: string): number {
  const db = getDatabase();
  const badges = db.prepare('SELECT badge_token FROM pending_badges WHERE batch_id = ?').all(batchId) as { badge_token: string }[];

  let linked = 0;
  for (const badge of badges) {
    try {
      createSessionBadge(sessionId, badge.badge_token, nanoid());
      markBadgeDelivered(sessionId, badge.badge_token);
      linked++;
    } catch { /* duplicate, skip */ }
  }

  markBatchUsed(batchId);
  return linked;
}

/**
 * Notify linked users via LINE push (async)
 */
async function notifyLinkedUsers(sessionId: string, badgeTokens: string[]): Promise<void> {
  try {
    const { sendPhotoPush } = require('./line-push');
    for (const token of badgeTokens) {
      const user = getBadgeUserByToken(token);
      if (user?.line_user_id) {
        await sendPhotoPush(user.line_user_id, token, user.event_id);
        markBadgeNotified(sessionId, token);
      }
    }
  } catch {
    // LINE push not configured or service unavailable — ok
  }
}

/**
 * Retry worker: re-deliver undelivered badges (max 3 retries)
 * Run every 30 seconds
 */
export function startRetryWorker(): void {
  setInterval(() => {
    try {
      const undelivered = getUndeliveredBadges();
      if (undelivered.length === 0) return;

      console.log(`[Badge] Retry: ${undelivered.length} undelivered badges`);
      for (const badge of undelivered) {
        try {
          markBadgeDelivered(badge.session_id, badge.badge_token);
          // Try LINE push if not notified
          if (!badge.notified && badge.line_user_id) {
            notifyLinkedUsers(badge.session_id, [badge.badge_token]).catch(() => {});
          }
        } catch (err: any) {
          incrementRetryCount(badge.session_id, badge.badge_token, err.message);
        }
      }
    } catch (err: any) {
      console.warn(`[Badge] Retry worker error: ${err.message}`);
    }
  }, 30_000);
}

/**
 * Cleanup worker: expire old pending batches (> 15 min)
 * Run every 5 minutes
 */
export function startCleanupWorker(): void {
  setInterval(() => {
    try {
      cleanupExpiredBatches();
    } catch { /* ignore */ }
  }, 5 * 60_000);
}
