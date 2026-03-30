import chokidar from 'chokidar';
import path from 'path';
import fs from 'fs';
import { CONFIG } from '../config';
import { getSessionBySeriesId, upsertSession } from '../db/database';
import { createDeliveryForSession, getLocalIpAddress } from './qr-service';
import { syncToCloud } from './firebase';
import { indexFaceFromPhoto } from './face-service';

/** Track processed files to avoid duplicates */
const processedFiles = new Set<string>();

/** Debounce map: seriesId → timeout */
const seriesDebounce = new Map<string, NodeJS.Timeout>();

type SourceFormat = '3acts' | 'matrix' | 'standard' | 'flat';

/**
 * Auto-detect folder format:
 * - 3ActsBooth: {folder}/BackUp/Series/{id}/PhotoQR/*.jpg
 * - MATRIX:     {folder}/{YYYY-MM-DD_HHmmss}/CAM_001.jpg + bullet_time.mp4
 * - Standard:   {folder}/{boothId}/{sessionId}/photo.jpg + metadata.json
 * - Flat:       {folder}/*.jpg + *.mp4 (any other structure)
 */
function detectFormat(watchFolder: string): SourceFormat {
  const seriesPath = path.join(watchFolder, 'BackUp', 'Series');
  if (fs.existsSync(seriesPath)) return '3acts';

  // Check if subfolders match MATRIX pattern (YYYY-MM-DD_HHmmss)
  try {
    const dirs = fs.readdirSync(watchFolder).filter(d => {
      return fs.statSync(path.join(watchFolder, d)).isDirectory() && /^\d{4}-\d{2}-\d{2}_\d{6}$/.test(d);
    });
    if (dirs.length > 0) return 'matrix';
  } catch { /* ignore */ }

  // Check Standard format: {folder}/{boothId}/{sessionId}/ with photo files
  try {
    const topDirs = fs.readdirSync(watchFolder).filter(d => {
      const full = path.join(watchFolder, d);
      return fs.statSync(full).isDirectory() && !d.startsWith('.') && !d.startsWith('_');
    });
    for (const boothDir of topDirs) {
      const boothPath = path.join(watchFolder, boothDir);
      const subDirs = fs.readdirSync(boothPath).filter(d => {
        const full = path.join(boothPath, d);
        return fs.statSync(full).isDirectory() && !d.startsWith('.');
      });
      for (const sessionDir of subDirs) {
        const sessionPath = path.join(boothPath, sessionDir);
        const files = fs.readdirSync(sessionPath);
        // Standard format has photo.jpg or metadata.json
        if (files.some(f => /^photo\.(jpg|jpeg|png|webp)$/i.test(f)) || files.includes('metadata.json')) {
          return 'standard';
        }
      }
    }
  } catch { /* ignore */ }

  return 'flat';
}

/**
 * Check if a file's size is stable (not being written to).
 * Returns true if file size doesn't change over the check period.
 */
async function isFileStable(filePath: string, waitMs = 1000): Promise<boolean> {
  try {
    const stat1 = fs.statSync(filePath);
    await new Promise(resolve => setTimeout(resolve, waitMs));
    if (!fs.existsSync(filePath)) return false;
    const stat2 = fs.statSync(filePath);
    return stat1.size === stat2.size && stat1.mtimeMs === stat2.mtimeMs;
  } catch {
    return false;
  }
}

export function startFolderWatcher(eventId?: string): void {
  const watchFolder = CONFIG.WATCH_FOLDER;
  if (!watchFolder) {
    console.warn('[Watcher] WATCH_FOLDER not set — skipping folder watch');
    return;
  }

  if (!fs.existsSync(watchFolder)) {
    console.warn(`[Watcher] Folder not found: ${watchFolder}`);
    return;
  }

  const format = detectFormat(watchFolder);
  console.log(`[Watcher] Detected format: ${format.toUpperCase()}`);
  console.log(`[Watcher] Watching: ${watchFolder}`);

  let patterns: string[];

  switch (format) {
    case '3acts': {
      const seriesBase = path.join(watchFolder, 'BackUp', 'Series');
      patterns = [
        path.join(seriesBase, '*', 'PhotoQR', '*.jpg'),
        path.join(seriesBase, '*', 'PhotoQR', '*.jpeg'),
        path.join(seriesBase, '*', 'Clip', '*.mp4'),
        path.join(seriesBase, '*', 'Photo', '*.jpg'),
        path.join(seriesBase, '*', 'Photo', '*.jpeg'),
      ];
      break;
    }
    case 'matrix': {
      // MATRIX: {folder}/{YYYY-MM-DD_HHmmss}/CAM_*.jpg + bullet_time.mp4
      patterns = [
        path.join(watchFolder, '*', 'CAM_*.jpg'),
        path.join(watchFolder, '*', 'bullet_time.mp4'),
        path.join(watchFolder, '*', '*.mp4'),
      ];
      break;
    }
    case 'standard': {
      // Standard: {folder}/{boothId}/{sessionId}/photo*.jpg + clip.* + metadata.json
      // Skip .tmp_ folders (atomic write pattern)
      patterns = [
        path.join(watchFolder, '*', '*', 'photo*.jpg'),
        path.join(watchFolder, '*', '*', 'photo*.jpeg'),
        path.join(watchFolder, '*', '*', 'photo*.png'),
        path.join(watchFolder, '*', '*', 'photo*.webp'),
        path.join(watchFolder, '*', '*', 'clip.*'),
        path.join(watchFolder, '*', '*', 'metadata.json'),
      ];
      break;
    }
    default: {
      // Flat: watch any jpg/mp4 in subfolders
      patterns = [
        path.join(watchFolder, '*', '*.jpg'),
        path.join(watchFolder, '*', '*.jpeg'),
        path.join(watchFolder, '*', '*.mp4'),
        path.join(watchFolder, '*.jpg'),
        path.join(watchFolder, '*.mp4'),
      ];
      break;
    }
  }

  // Normalize paths for chokidar (forward slashes)
  patterns = patterns.map(p => p.replace(/\\/g, '/'));

  const watcher = chokidar.watch(patterns, {
    persistent: true,
    ignoreInitial: false,
    awaitWriteFinish: {
      stabilityThreshold: 2000,
      pollInterval: 500,
    },
  });

  watcher.on('add', (filePath: string) => {
    handleNewFile(filePath, format, eventId);
  });

  watcher.on('error', (err: unknown) => {
    console.error('[Watcher] Error:', (err as Error).message);
  });
}

function handleNewFile(filePath: string, format: SourceFormat, eventId?: string): void {
  const normalized = filePath.replace(/\\/g, '/');
  if (processedFiles.has(normalized)) return;

  // ─── Atomic write: skip .tmp_ folders ───
  if (normalized.includes('/.tmp_') || normalized.includes('\\.tmp_')) return;

  processedFiles.add(normalized);

  let sessionId: string;

  switch (format) {
    case '3acts': {
      // Parse: .../BackUp/Series/{seriesId}/{type}/{filename}
      const parts = normalized.split('/');
      const seriesIdx = parts.indexOf('Series');
      if (seriesIdx < 0 || seriesIdx + 3 >= parts.length) return;
      sessionId = parts[seriesIdx + 1];
      const fileType = parts[seriesIdx + 2];
      const fileName = parts[seriesIdx + 3];
      console.log(`[Watcher] 3Acts ${fileType}: ${fileName} (series: ${sessionId})`);
      break;
    }
    case 'matrix': {
      // Parse: .../OutputFolder/{YYYY-MM-DD_HHmmss}/{filename}
      const parts = normalized.split('/');
      const fileName = parts[parts.length - 1];
      sessionId = parts[parts.length - 2]; // folder name = session ID
      console.log(`[Watcher] MATRIX: ${fileName} (session: ${sessionId})`);
      break;
    }
    case 'standard': {
      // Parse: .../WATCH_FOLDER/{boothId}/{sessionId}/{filename}
      const parts = normalized.split('/');
      const fileName = parts[parts.length - 1];
      const sessionFolder = parts[parts.length - 2];
      const boothFolder = parts[parts.length - 3];
      // Skip temp/processing folders
      if (sessionFolder.startsWith('.') || sessionFolder.startsWith('_')) return;
      sessionId = `${boothFolder}/${sessionFolder}`;
      console.log(`[Watcher] Standard: ${fileName} (booth: ${boothFolder}, session: ${sessionFolder})`);
      break;
    }
    default: {
      // Flat: use parent folder name or filename
      const parts = normalized.split('/');
      const fileName = parts[parts.length - 1];
      const parent = parts[parts.length - 2];
      sessionId = parent || path.basename(fileName, path.extname(fileName));
      console.log(`[Watcher] File: ${fileName} (session: ${sessionId})`);
      break;
    }
  }

  // Debounce per session — wait 3s for all files to arrive
  const existing = seriesDebounce.get(sessionId);
  if (existing) clearTimeout(existing);

  seriesDebounce.set(sessionId, setTimeout(() => {
    seriesDebounce.delete(sessionId);
    processSessionFolder(sessionId, format, eventId);
  }, 3000));
}

async function processSessionFolder(sessionId: string, format: SourceFormat, eventId?: string): Promise<void> {
  try {
    let sessionPath: string;
    let photoFiles: string[] = [];
    let clipFiles: string[] = [];
    let primaryPhoto: string | null = null;
    let clipPath: string | null = null;

    switch (format) {
      case '3acts': {
        sessionPath = path.join(CONFIG.WATCH_FOLDER, 'BackUp', 'Series', sessionId);
        if (!fs.existsSync(sessionPath)) return;

        const photoQrDir = path.join(sessionPath, 'PhotoQR');
        const clipDir = path.join(sessionPath, 'Clip');
        const photoDir = path.join(sessionPath, 'Photo');

        const photoQrFiles = safeReadDir(photoQrDir).filter(f => /\.(jpg|jpeg)$/i.test(f));
        clipFiles = safeReadDir(clipDir).filter(f => /\.mp4$/i.test(f));
        photoFiles = safeReadDir(photoDir).filter(f => /\.(jpg|jpeg)$/i.test(f));

        primaryPhoto = photoQrFiles.length > 0
          ? path.join(photoQrDir, photoQrFiles[0])
          : photoFiles.length > 0
            ? path.join(photoDir, photoFiles[0])
            : null;

        clipPath = clipFiles.length > 0 ? path.join(clipDir, clipFiles[0]) : null;
        break;
      }
      case 'matrix': {
        // MATRIX: {outputFolder}/{YYYY-MM-DD_HHmmss}/
        sessionPath = path.join(CONFIG.WATCH_FOLDER, sessionId);
        if (!fs.existsSync(sessionPath)) return;

        const allFiles = safeReadDir(sessionPath);
        photoFiles = allFiles.filter(f => /^CAM_\d+\.jpg$/i.test(f));
        clipFiles = allFiles.filter(f => /\.mp4$/i.test(f));

        // Primary photo = last CAM (highest number = best angle usually)
        // Or first CAM if you prefer
        if (photoFiles.length > 0) {
          primaryPhoto = path.join(sessionPath, photoFiles[photoFiles.length - 1]);
        }

        // Clip = bullet_time.mp4 preferred
        const bulletTime = allFiles.find(f => f === 'bullet_time.mp4');
        clipPath = bulletTime
          ? path.join(sessionPath, bulletTime)
          : clipFiles.length > 0
            ? path.join(sessionPath, clipFiles[0])
            : null;
        break;
      }
      case 'standard': {
        // Standard: {WATCH_FOLDER}/{boothId}/{sessionFolder}/
        sessionPath = path.join(CONFIG.WATCH_FOLDER, sessionId); // sessionId = "boothId/sessionFolder"
        if (!fs.existsSync(sessionPath)) return;

        const stdFiles = safeReadDir(sessionPath);

        // File stability check — ensure files are fully written
        const primaryCandidates = stdFiles.filter(f => /^photo\.(jpg|jpeg|png|webp)$/i.test(f));
        const extraPhotos = stdFiles.filter(f => /^photo_\d+\.(jpg|jpeg|png|webp)$/i.test(f));
        photoFiles = [...primaryCandidates, ...extraPhotos];
        clipFiles = stdFiles.filter(f => /^clip\.(mp4|webm|mov)$/i.test(f));

        // Prefer photo.jpg as primary
        if (primaryCandidates.length > 0) {
          primaryPhoto = path.join(sessionPath, primaryCandidates[0]);
        } else if (photoFiles.length > 0) {
          primaryPhoto = path.join(sessionPath, photoFiles[0]);
        }

        clipPath = clipFiles.length > 0 ? path.join(sessionPath, clipFiles[0]) : null;

        // Stability check for primary photo
        if (primaryPhoto) {
          const stable = await isFileStable(primaryPhoto);
          if (!stable) {
            console.log(`[Watcher] Standard: file still being written, re-queuing ${sessionId}`);
            processedFiles.delete(sessionId);
            setTimeout(() => processSessionFolder(sessionId, format, eventId), 2000);
            return;
          }
        }
        break;
      }
      default: {
        sessionPath = path.join(CONFIG.WATCH_FOLDER, sessionId);
        if (!fs.existsSync(sessionPath)) {
          // Flat file in root
          sessionPath = CONFIG.WATCH_FOLDER;
        }
        const allFiles = safeReadDir(sessionPath);
        photoFiles = allFiles.filter(f => /\.(jpg|jpeg)$/i.test(f));
        clipFiles = allFiles.filter(f => /\.mp4$/i.test(f));
        primaryPhoto = photoFiles.length > 0 ? path.join(sessionPath, photoFiles[0]) : null;
        clipPath = clipFiles.length > 0 ? path.join(sessionPath, clipFiles[0]) : null;
        break;
      }
    }

    if (!primaryPhoto) {
      console.log(`[Watcher] No photos found in session ${sessionId}, skipping`);
      return;
    }

    // Read index.json for metadata (if exists)
    let metadata: any = {};
    const indexPath = path.join(sessionPath, 'index.json');
    if (fs.existsSync(indexPath)) {
      try { metadata = JSON.parse(fs.readFileSync(indexPath, 'utf-8')); } catch { /* ignore */ }
    }

    // Generate session code (last 4 chars of sessionId, digits only)
    const digits = sessionId.replace(/\D/g, '');
    const sessionCode = digits.slice(-4) || sessionId.slice(-4);
    const dbSessionId = metadata.sessionId || `sh-${sessionId}`;

    // Create QR delivery first (need token for PhotoQR overlay)
    const delivery = await createDeliveryForSession(dbSessionId, primaryPhoto, clipPath || undefined);
    let photoQrPath: string | null = null;

    // ─── Generate PhotoQR (Photo + QR overlay in corner) ───
    if (delivery && primaryPhoto) {
      try {
        const photoQrDir = path.join(sessionPath, 'PhotoQR');
        if (!fs.existsSync(photoQrDir)) fs.mkdirSync(photoQrDir, { recursive: true });

        photoQrPath = path.join(photoQrDir, 'photoqr_001.jpg');

        if (!fs.existsSync(photoQrPath)) {
          const sharp = require('sharp') as typeof import('sharp');
          const QRCode = require('qrcode');

          // Generate QR as PNG buffer (200x200)
          const qrBuffer = await QRCode.toBuffer(delivery.downloadUrl, {
            width: 200, margin: 1,
            color: { dark: '#000000', light: '#FFFFFF' },
          });

          // Get photo dimensions
          const photoMeta = await (sharp as any)(primaryPhoto).metadata();
          const pw = photoMeta.width || 1200;
          const ph = photoMeta.height || 800;

          // QR size = 12% of shorter side
          const qrSize = Math.round(Math.min(pw, ph) * 0.12);
          const margin = Math.round(qrSize * 0.15);

          // Resize QR to target size
          const qrResized = await (sharp as any)(qrBuffer)
            .resize(qrSize, qrSize)
            .png()
            .toBuffer();

          // Composite QR onto bottom-right corner of photo
          await (sharp as any)(primaryPhoto)
            .composite([{
              input: qrResized,
              left: pw - qrSize - margin,
              top: ph - qrSize - margin,
            }])
            .jpeg({ quality: 90 })
            .toFile(photoQrPath);

          console.log(`[Watcher] PhotoQR created: ${path.basename(photoQrPath)} (QR: ${qrSize}px)`);
        }
      } catch (err: any) {
        console.warn(`[Watcher] PhotoQR generation failed: ${err.message}`);
        photoQrPath = null;
      }
    }

    // Upsert session (with PhotoQR path if created)
    upsertSession({
      id: dbSessionId,
      event_id: eventId || metadata.eventId || undefined,
      series_id: sessionId,
      session_code: sessionCode,
      rendered_image_path: primaryPhoto,
      photo_qr_path: photoQrPath || primaryPhoto,
      clip_path: clipPath || undefined,
      act_count: photoFiles.length || 1,
    });

    console.log(`[Watcher] Session: ${dbSessionId} | Photos: ${photoFiles.length} | Clip: ${clipPath ? 'Yes' : 'No'} | QR: ${photoQrPath ? 'Yes' : 'No'} | Code: ${sessionCode}`);

    if (delivery) {
      console.log(`[Watcher] QR: ${delivery.token} → ${delivery.downloadUrl}`);

      // ─── Face Index (background, non-blocking) ───
      indexFaceFromPhoto(primaryPhoto, dbSessionId, eventId || metadata.eventId || 'default')
        .then(ok => {
          if (ok) console.log(`[Watcher] Face indexed: ${dbSessionId}`);
        })
        .catch(() => { /* face service offline — ok */ });

      // ─── PhotoQRbag: auto-link pending badges ───
      try {
        const { linkPendingBadgesToSession } = require('./badge-delivery');
        const linked = linkPendingBadgesToSession(dbSessionId);
        if (linked > 0) console.log(`[Watcher] Badge: ${linked} users linked to ${dbSessionId}`);
      } catch (err: any) {
        console.warn(`[Watcher] Badge link failed: ${err.message}`);
      }

      // ─── Cloud sync (background, non-blocking) ───
      syncToCloud({
        eventId: eventId || metadata.eventId || 'default',
        eventName: metadata.eventName || 'Event',
        sessionId: dbSessionId,
        seriesId: sessionId,
        photoPath: photoQrPath || primaryPhoto,
        clipPath: clipPath || undefined,
        qrToken: delivery.token,
        localServerIp: getLocalIpAddress(),
        localServerPort: CONFIG.PORT,
      }).catch(err => {
        console.warn(`[Watcher] Cloud sync failed: ${err.message}`);
      });
    }
  } catch (err: any) {
    console.error(`[Watcher] Error processing ${sessionId}:`, err.message);
  }
}

function safeReadDir(dirPath: string): string[] {
  try {
    if (!fs.existsSync(dirPath)) return [];
    return fs.readdirSync(dirPath).sort();
  } catch {
    return [];
  }
}

/** Scan all existing sessions on startup */
export function scanExistingSeries(eventId?: string): void {
  const watchFolder = CONFIG.WATCH_FOLDER;
  if (!watchFolder || !fs.existsSync(watchFolder)) return;

  const format = detectFormat(watchFolder);
  let dirs: string[] = [];

  switch (format) {
    case '3acts': {
      const seriesBase = path.join(watchFolder, 'BackUp', 'Series');
      if (!fs.existsSync(seriesBase)) return;
      dirs = fs.readdirSync(seriesBase).filter(d =>
        fs.statSync(path.join(seriesBase, d)).isDirectory()
      );
      break;
    }
    case 'matrix': {
      dirs = fs.readdirSync(watchFolder).filter(d =>
        fs.statSync(path.join(watchFolder, d)).isDirectory() && /^\d{4}-\d{2}-\d{2}_\d{6}$/.test(d)
      );
      break;
    }
    case 'standard': {
      // Standard: scan {boothId}/{sessionId}/ — skip .tmp_ folders
      const boothDirs = fs.readdirSync(watchFolder).filter(d => {
        const full = path.join(watchFolder, d);
        return fs.statSync(full).isDirectory() && !d.startsWith('.') && !d.startsWith('_');
      });
      for (const boothDir of boothDirs) {
        const boothPath = path.join(watchFolder, boothDir);
        const sessionDirs = fs.readdirSync(boothPath).filter(d => {
          const full = path.join(boothPath, d);
          return fs.statSync(full).isDirectory() && !d.startsWith('.') && !d.startsWith('_');
        });
        for (const sessionDir of sessionDirs) {
          dirs.push(`${boothDir}/${sessionDir}`);
        }
      }
      break;
    }
    default: {
      dirs = fs.readdirSync(watchFolder).filter(d =>
        fs.statSync(path.join(watchFolder, d)).isDirectory()
      );
      break;
    }
  }

  console.log(`[Watcher] Found ${dirs.length} existing sessions (${format})`);

  for (const sessionId of dirs) {
    const existing = getSessionBySeriesId(sessionId);
    if (!existing) {
      processSessionFolder(sessionId, format, eventId);
    }
  }
}
