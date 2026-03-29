import path from 'path';
import fs from 'fs';
import { CONFIG } from '../config';

let admin: any = null;
let bucket: any = null;
let firestore: any = null;
let initialized = false;

function ensureInit(): boolean {
  if (initialized) return !!admin;

  try {
    // Find service account key
    let keyPath = CONFIG.FIREBASE_KEY;
    if (!keyPath) {
      // Auto-detect in current directory
      const files = fs.readdirSync(process.cwd()).filter(f => f.includes('firebase-adminsdk') && f.endsWith('.json'));
      if (files.length > 0) keyPath = path.join(process.cwd(), files[0]);
    }

    if (!keyPath || !fs.existsSync(keyPath)) {
      console.warn('[Firebase] No service account key found — cloud sync disabled');
      initialized = true;
      return false;
    }

    admin = require('firebase-admin');
    const serviceAccount = JSON.parse(fs.readFileSync(keyPath, 'utf-8'));

    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      storageBucket: CONFIG.FIREBASE_BUCKET,
    });

    bucket = admin.storage().bucket();
    firestore = admin.firestore();
    initialized = true;
    console.log('[Firebase] Initialized with project:', serviceAccount.project_id);
    return true;
  } catch (err: any) {
    console.error('[Firebase] Init failed:', err.message);
    initialized = true;
    return false;
  }
}

export function isFirebaseConfigured(): boolean {
  return ensureInit() && !!admin;
}

async function uploadToStorage(localPath: string, remotePath: string, contentType: string): Promise<string> {
  if (!bucket) throw new Error('Firebase not initialized');

  const file = bucket.file(remotePath);
  await file.save(fs.readFileSync(localPath), {
    metadata: { contentType },
    public: true,
  });

  // Return public URL
  return `https://firebasestorage.googleapis.com/v0/b/${CONFIG.FIREBASE_BUCKET}/o/${encodeURIComponent(remotePath)}?alt=media`;
}

export interface CloudSyncParams {
  eventId: string;
  eventName: string;
  sessionId: string;
  seriesId: string;
  photoPath: string;
  clipPath?: string;
  qrToken: string;
  themeId?: string;
  localServerIp?: string;
  localServerPort?: number;
}

export async function syncToCloud(params: CloudSyncParams): Promise<{ photoUrl: string; clipUrl?: string } | null> {
  if (!ensureInit() || !admin) {
    console.log('[Firebase] Not configured — skipping cloud sync');
    return null;
  }

  try {
    const { eventId, sessionId, seriesId, photoPath, clipPath, qrToken } = params;
    const basePath = `events/${eventId}/sessions/${seriesId}`;

    // Compress + upload photo
    let photoUrl = '';
    if (fs.existsSync(photoPath)) {
      try {
        const sharp = require('sharp') as typeof import('sharp');
        const compressed = await (sharp as any)(photoPath)
          .resize(1200, undefined, { fit: 'inside', withoutEnlargement: true })
          .jpeg({ quality: 80 })
          .toBuffer();

        const remotePath = `${basePath}/photo_${seriesId}.jpg`;
        const file = bucket.file(remotePath);
        await file.save(compressed, { metadata: { contentType: 'image/jpeg' }, public: true });
        photoUrl = `https://firebasestorage.googleapis.com/v0/b/${CONFIG.FIREBASE_BUCKET}/o/${encodeURIComponent(remotePath)}?alt=media`;
      } catch {
        // Fallback: upload original
        photoUrl = await uploadToStorage(photoPath, `${basePath}/photo_${seriesId}.jpg`, 'image/jpeg');
      }
    }

    // Upload clip (if exists)
    let clipUrl: string | undefined;
    if (clipPath && fs.existsSync(clipPath)) {
      clipUrl = await uploadToStorage(clipPath, `${basePath}/clip_${seriesId}.mp4`, 'video/mp4');
    }

    // Write Firestore delivery doc
    const ttlMs = CONFIG.QR_EXPIRY_HOURS * 60 * 60 * 1000;
    const deliveryDoc = {
      eventId,
      eventName: params.eventName,
      sessionId,
      seriesId,
      photoUrl,
      clipUrl: clipUrl || null,
      qrToken,
      themeId: params.themeId || 'premium-white-gold',
      locationType: 'hybrid',
      localServerIp: params.localServerIp || null,
      localServerPort: params.localServerPort || CONFIG.PORT,
      createdAt: new Date().toISOString(),
      expireAt: new Date(Date.now() + ttlMs).toISOString(),
    };

    await firestore.collection('deliveries').doc(qrToken).set(deliveryDoc);
    console.log(`[Firebase] Synced session ${sessionId} → token ${qrToken}`);

    return { photoUrl, clipUrl };
  } catch (err: any) {
    console.error('[Firebase] Sync error:', err.message);
    return null;
  }
}

export async function deleteEventFromCloud(eventId: string): Promise<void> {
  if (!ensureInit() || !admin) return;

  try {
    // Delete storage files
    const [files] = await bucket.getFiles({ prefix: `events/${eventId}/` });
    for (const file of files) {
      await file.delete().catch(() => { /* ignore */ });
    }

    // Delete Firestore deliveries
    const snap = await firestore.collection('deliveries').where('eventId', '==', eventId).get();
    const batch = firestore.batch();
    snap.docs.forEach((doc: any) => batch.delete(doc.ref));
    await batch.commit();

    console.log(`[Firebase] Deleted event ${eventId} from cloud`);
  } catch (err: any) {
    console.error('[Firebase] Delete error:', err.message);
  }
}
