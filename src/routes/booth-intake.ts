import { Router, Request, Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { CONFIG } from '../config';
import { boothAuth } from '../middleware/booth-auth';
import {
  upsertSession, checkBoothDuplicate, recordBoothUpload,
  updateSessionStatus, getBoothUploadStats, addToCloudSyncQueue,
} from '../db/database';
import { createDeliveryForSession, getLocalIpAddress } from '../services/qr-service';
import { syncToCloud } from '../services/firebase';
import { indexFaceFromPhoto } from '../services/face-service';

const { nanoid } = require('nanoid') as { nanoid: (size?: number) => string };

const router = Router();

// ─── Multer: diskStorage (never memoryStorage) ─────────────

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    // Temp upload dir — files moved to final location after validation
    const tmpDir = path.join(CONFIG.INTAKE_FOLDER, '_tmp');
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
    cb(null, tmpDir);
  },
  filename: (_req, file, cb) => {
    // Unique temp filename to avoid collisions
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${nanoid(12)}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: {
    fileSize: CONFIG.MAX_UPLOAD_SIZE * 1024 * 1024, // MB → bytes
    files: 2, // photo + clip max
  },
  fileFilter: (_req, file, cb) => {
    const allowedPhoto = /\.(jpg|jpeg|png|webp)$/i;
    const allowedClip = /\.(mp4|webm|mov)$/i;
    const ext = path.extname(file.originalname).toLowerCase();

    if (file.fieldname === 'photo' && allowedPhoto.test(ext)) {
      cb(null, true);
    } else if (file.fieldname === 'clip' && allowedClip.test(ext)) {
      cb(null, true);
    } else {
      cb(new Error(`Invalid file type: ${file.originalname} (field: ${file.fieldname})`));
    }
  },
});

// ─── POST /api/booth/upload ────────────────────────────────
router.post('/upload',
  boothAuth,
  (req: Request, res: Response, next) => {
    upload.fields([
      { name: 'photo', maxCount: 1 },
      { name: 'clip', maxCount: 1 },
    ])(req, res, (err) => {
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return res.status(413).json({ error: `File too large. Max ${CONFIG.MAX_UPLOAD_SIZE}MB` });
        }
        return res.status(400).json({ error: err.message });
      }
      if (err) return res.status(400).json({ error: err.message });
      next();
    });
  },
  async (req: Request, res: Response) => {
    const files = req.files as { [fieldname: string]: Express.Multer.File[] } | undefined;
    const photoFile = files?.photo?.[0];
    const clipFile = files?.clip?.[0];

    // ─── Validate required fields ───
    const boothId = req.body.boothId as string;
    if (!boothId) {
      cleanupFiles(photoFile, clipFile);
      return res.status(400).json({ error: 'boothId is required' });
    }

    if (!photoFile) {
      cleanupFiles(undefined, clipFile);
      return res.status(400).json({ error: 'photo file is required' });
    }

    // ─── Duplicate check ───
    const fileHash = computeFileHash(boothId, photoFile.originalname, photoFile.size);
    if (checkBoothDuplicate(boothId, fileHash)) {
      cleanupFiles(photoFile, clipFile);
      return res.status(409).json({ error: 'Duplicate upload detected (same file within 5 minutes)' });
    }

    // ─── Parse optional metadata ───
    let metadata: Record<string, unknown> = {};
    if (req.body.metadata) {
      try { metadata = JSON.parse(req.body.metadata); } catch { /* ignore */ }
    }
    const eventId = (req.body.eventId as string) || (metadata.eventId as string) || 'default';

    // ─── Move files to final location ───
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const sessionDir = path.join(CONFIG.INTAKE_FOLDER, boothId, `${timestamp}-${nanoid(6)}`);
    fs.mkdirSync(sessionDir, { recursive: true });

    const finalPhotoPath = path.join(sessionDir, `photo${path.extname(photoFile.originalname).toLowerCase()}`);
    fs.renameSync(photoFile.path, finalPhotoPath);

    let finalClipPath: string | undefined;
    let hasClip = false;
    if (clipFile) {
      try {
        finalClipPath = path.join(sessionDir, `clip${path.extname(clipFile.originalname).toLowerCase()}`);
        fs.renameSync(clipFile.path, finalClipPath);
        hasClip = true;
      } catch (err: any) {
        console.warn(`[BoothIntake] Clip move failed: ${err.message} — continuing without clip`);
        finalClipPath = undefined;
      }
    }

    // ─── Create session (status: processing) ───
    const seriesId = `${boothId}/${path.basename(sessionDir)}`;
    const dbSessionId = `sh-intake-${nanoid(8)}`;
    const digits = timestamp.replace(/\D/g, '');
    const sessionCode = digits.slice(-4);

    upsertSession({
      id: dbSessionId,
      event_id: eventId,
      series_id: seriesId,
      session_code: sessionCode,
      rendered_image_path: finalPhotoPath,
      clip_path: finalClipPath,
      act_count: 1,
    });
    updateSessionStatus(dbSessionId, 'processing');

    // ─── Generate QR + PhotoQR overlay ───
    let delivery: Awaited<ReturnType<typeof createDeliveryForSession>> = null;
    let photoQrPath: string | null = null;

    try {
      delivery = await createDeliveryForSession(dbSessionId, finalPhotoPath, finalClipPath);

      if (delivery) {
        // Generate PhotoQR overlay
        try {
          const sharp = require('sharp') as typeof import('sharp');
          const QRCode = require('qrcode');

          const qrBuffer = await QRCode.toBuffer(delivery.downloadUrl, {
            width: 200, margin: 1,
            color: { dark: '#000000', light: '#FFFFFF' },
          });

          const photoMeta = await (sharp as any)(finalPhotoPath).metadata();
          const pw = photoMeta.width || 1200;
          const ph = photoMeta.height || 800;
          const qrSize = Math.round(Math.min(pw, ph) * 0.12);
          const margin = Math.round(qrSize * 0.15);

          const qrResized = await (sharp as any)(qrBuffer)
            .resize(qrSize, qrSize).png().toBuffer();

          photoQrPath = path.join(sessionDir, 'photoqr.jpg');
          await (sharp as any)(finalPhotoPath)
            .composite([{
              input: qrResized,
              left: pw - qrSize - margin,
              top: ph - qrSize - margin,
            }])
            .jpeg({ quality: 90 })
            .toFile(photoQrPath);

          // Update session with PhotoQR path
          upsertSession({
            id: dbSessionId,
            series_id: seriesId,
            photo_qr_path: photoQrPath,
          });
        } catch (err: any) {
          console.warn(`[BoothIntake] PhotoQR generation failed: ${err.message}`);
        }
      }

      // ─── Status: ready (QR created successfully) ───
      updateSessionStatus(dbSessionId, 'ready');
    } catch (err: any) {
      console.error(`[BoothIntake] QR generation failed: ${err.message}`);
      updateSessionStatus(dbSessionId, 'ready'); // still mark ready — photo is accessible
    }

    // ─── Record upload for dedup ───
    recordBoothUpload(nanoid(12), boothId, fileHash, dbSessionId);

    // ─── Background tasks (non-blocking) ───

    // Face indexing
    indexFaceFromPhoto(finalPhotoPath, dbSessionId, eventId)
      .catch(() => { /* face service offline — ok */ });

    // Badge linking
    try {
      const { linkPendingBadgesToSession } = require('../services/badge-delivery');
      const linked = linkPendingBadgesToSession(dbSessionId);
      if (linked > 0) console.log(`[BoothIntake] Badge: ${linked} users linked to ${dbSessionId}`);
    } catch { /* badge service not critical */ }

    // Cloud sync with retry queue
    if (delivery) {
      const syncId = nanoid(12);
      addToCloudSyncQueue({
        id: syncId,
        session_id: dbSessionId,
        event_id: eventId,
        photo_path: photoQrPath || finalPhotoPath,
        clip_path: finalClipPath,
        qr_token: delivery.token,
        series_id: seriesId,
      });

      syncToCloud({
        eventId,
        eventName: (metadata.eventName as string) || 'Event',
        sessionId: dbSessionId,
        seriesId,
        photoPath: photoQrPath || finalPhotoPath,
        clipPath: finalClipPath,
        qrToken: delivery.token,
        localServerIp: getLocalIpAddress(),
        localServerPort: CONFIG.PORT,
      }).then(() => {
        const { markCloudSyncDone } = require('../db/database');
        markCloudSyncDone(syncId);
      }).catch((err: any) => {
        console.warn(`[BoothIntake] Cloud sync queued for retry: ${err.message}`);
        const { markCloudSyncFailed } = require('../db/database');
        markCloudSyncFailed(syncId, err.message);
      });
    }

    console.log(`[BoothIntake] Session: ${dbSessionId} | Booth: ${boothId} | Photo: ✓ | Clip: ${hasClip ? '✓' : '✗'} | QR: ${delivery ? '✓' : '✗'}`);

    res.status(201).json({
      sessionId: dbSessionId,
      seriesId,
      token: delivery?.token || null,
      downloadUrl: delivery?.downloadUrl || null,
      localUrl: delivery?.localDownloadUrl || null,
      photoPath: finalPhotoPath,
      clipPath: finalClipPath || null,
      hasClip,
      status: 'ready',
    });
  },
);

// ─── POST /api/booth/upload-meta ──────────────────────────────
// Webhook from 3ActsBooth: metadata only (files on shared disk)
router.post('/upload-meta',
  boothAuth,
  async (req: Request, res: Response) => {
    const {
      sessionId, eventId, boothId,
      renderedPhotoPath, photoQrPath, clipPath,
      qrToken, seriesId, sessionCode,
    } = req.body as {
      sessionId: string; eventId: string; boothId?: string;
      renderedPhotoPath?: string; photoQrPath?: string; clipPath?: string;
      qrToken?: string; seriesId?: string; sessionCode?: string;
    };

    if (!sessionId || !eventId) {
      return res.status(400).json({ error: 'sessionId and eventId are required' });
    }

    // Verify photo file exists on shared disk
    if (renderedPhotoPath && !fs.existsSync(renderedPhotoPath)) {
      console.warn(`[BoothMeta] Photo not found on disk: ${renderedPhotoPath}`);
    }

    const dbSessionId = `sh-meta-${nanoid(8)}`;
    const sid = seriesId || `${boothId || 'booth'}/${sessionId}`;

    upsertSession({
      id: dbSessionId,
      event_id: eventId,
      series_id: sid,
      session_code: sessionCode || sessionId.slice(-4),
      rendered_image_path: renderedPhotoPath || '',
      photo_qr_path: photoQrPath || undefined,
      clip_path: clipPath || undefined,
      act_count: 1,
    });
    updateSessionStatus(dbSessionId, 'ready');

    // Badge auto-link
    try {
      const { linkPendingBadgesToSession } = require('../services/badge-delivery');
      const linked = linkPendingBadgesToSession(dbSessionId, boothId);
      if (linked > 0) console.log(`[BoothMeta] Badge: ${linked} users linked to ${dbSessionId}`);
    } catch { /* badge service not critical */ }

    // Face indexing
    if (renderedPhotoPath && fs.existsSync(renderedPhotoPath)) {
      indexFaceFromPhoto(renderedPhotoPath, dbSessionId, eventId)
        .catch(() => { /* face service offline */ });
    }

    console.log(`[BoothMeta] Session: ${dbSessionId} | From: ${boothId || '?'} | Photo: ${renderedPhotoPath ? '✓' : '✗'}`);

    res.status(201).json({
      ok: true,
      sessionId: dbSessionId,
      seriesId: sid,
      linked: true,
    });
  },
);

// ─── GET /api/booth/status ─────────────────────────────────
router.get('/status', (req: Request, res: Response) => {
  const ip = getLocalIpAddress();
  const stats = getBoothUploadStats();

  res.json({
    ready: true,
    version: '2.0.0',
    serverIp: ip,
    port: CONFIG.PORT,
    httpsPort: CONFIG.HTTPS_PORT,
    uptimeSeconds: Math.floor(process.uptime()),
    intakeFolder: CONFIG.INTAKE_FOLDER,
    maxUploadSizeMB: CONFIG.MAX_UPLOAD_SIZE,
    allowedBooths: CONFIG.ALLOWED_BOOTHS ? CONFIG.ALLOWED_BOOTHS.split(',').map(s => s.trim()) : 'all',
    booths: stats,
    endpoints: {
      upload: `http://${ip}:${CONFIG.PORT}/api/booth/upload`,
      status: `http://${ip}:${CONFIG.PORT}/api/booth/status`,
    },
  });
});

// ─── GET /api/booth/stats ──────────────────────────────────
router.get('/stats', boothAuth, (_req: Request, res: Response) => {
  const stats = getBoothUploadStats();
  res.json({ booths: stats });
});

// ─── Helpers ───────────────────────────────────────────────

function computeFileHash(boothId: string, filename: string, fileSize: number): string {
  return crypto.createHash('md5')
    .update(`${boothId}:${filename}:${fileSize}`)
    .digest('hex');
}

function cleanupFiles(photo?: Express.Multer.File, clip?: Express.Multer.File): void {
  try {
    if (photo?.path && fs.existsSync(photo.path)) fs.unlinkSync(photo.path);
    if (clip?.path && fs.existsSync(clip.path)) fs.unlinkSync(clip.path);
  } catch { /* best effort cleanup */ }
}

export default router;
