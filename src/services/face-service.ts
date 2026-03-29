import { CONFIG } from '../config';

/** In-memory store for face search results (5min TTL) */
const resultStore = new Map<string, { uploaded: boolean; sessionIds?: string[]; createdAt: number }>();

// Cleanup every 5 min
setInterval(() => {
  const now = Date.now();
  for (const [key, val] of resultStore) {
    if (now - val.createdAt > 5 * 60 * 1000) resultStore.delete(key);
  }
}, 5 * 60 * 1000);

export async function checkFaceServiceHealth(): Promise<boolean> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 5000);
    const res = await fetch(`${CONFIG.FACE_SERVICE_URL}/health`, { signal: ctrl.signal });
    clearTimeout(timer);
    return res.ok;
  } catch {
    return false;
  }
}

export async function searchByFace(imageBase64: string, eventId?: string): Promise<string[]> {
  const res = await fetch(`${CONFIG.FACE_SERVICE_URL}/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image: imageBase64, event_id: eventId }),
  });

  if (!res.ok) throw new Error(`Face search failed: ${res.status}`);

  const data = await res.json() as any;
  return (data.results || []).map((r: any) => r.session_id);
}

export async function indexPhotos(photoPaths: Array<{ path: string; sessionId: string; eventId: string }>): Promise<{ indexed: number }> {
  const res = await fetch(`${CONFIG.FACE_SERVICE_URL}/index`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ photos: photoPaths }),
  });

  if (!res.ok) throw new Error(`Face index failed: ${res.status}`);

  const data = await res.json() as any;
  return { indexed: data.indexed || 0 };
}

/**
 * Index a single photo for face search (called automatically when new session detected)
 * Sends the photo to InsightFace service for embedding extraction
 */
export async function indexFaceFromPhoto(photoPath: string, sessionId: string, eventId: string): Promise<boolean> {
  try {
    const fs = require('fs');
    if (!fs.existsSync(photoPath)) return false;

    // Check if face service is online first
    const healthy = await checkFaceServiceHealth();
    if (!healthy) return false;

    // Send single photo for indexing
    const result = await indexPhotos([{ path: photoPath, sessionId, eventId }]);
    return result.indexed > 0;
  } catch {
    return false;
  }
}

export function storeUploadResult(token: string, sessionIds?: string[]): void {
  resultStore.set(token, { uploaded: true, sessionIds, createdAt: Date.now() });
}

export function getUploadResult(token: string) {
  return resultStore.get(token) || null;
}
