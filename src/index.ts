import http from 'http';
import https from 'https';
import fs from 'fs';
import path from 'path';
import { CONFIG } from './config';
import app from './app';
import { getDatabase } from './db/database';
import { startFolderWatcher, scanExistingSeries } from './services/folder-watcher';
import { getLocalIpAddress } from './services/qr-service';

// ─── Load .env if present ──────────────────────────────
const envPath = path.join(process.cwd(), '.env');
if (fs.existsSync(envPath)) {
  const lines = fs.readFileSync(envPath, 'utf-8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx < 0) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '');
    if (!process.env[key]) process.env[key] = val;
  }
}

// ─── Banner ────────────────────────────────────────────
console.log('');
console.log('  ╔══════════════════════════════════════╗');
console.log('  ║       ShareHub 2026  v1.0.0          ║');
console.log('  ║   Standalone Photo Sharing Server     ║');
console.log('  ╚══════════════════════════════════════╝');
console.log('');

// ─── Initialize Database ───────────────────────────────
try {
  getDatabase();
  console.log('[DB] SQLite initialized');
} catch (err: any) {
  console.error('[DB] Failed:', err.message);
  process.exit(1);
}

// ─── Ensure storage directories ────────────────────────
const storageDirs = ['qr'];
for (const dir of storageDirs) {
  const fullPath = path.join(CONFIG.STORAGE_PATH, dir);
  if (!fs.existsSync(fullPath)) fs.mkdirSync(fullPath, { recursive: true });
}

// ─── Start HTTP Server ─────────────────────────────────
const httpServer = http.createServer(app);
httpServer.listen(CONFIG.PORT, '0.0.0.0', () => {
  const ip = getLocalIpAddress();
  console.log(`[HTTP] http://${ip}:${CONFIG.PORT}`);
  console.log(`[HTTP] http://localhost:${CONFIG.PORT}`);
});

// ─── Start HTTPS Server (self-signed) ──────────────────
try {
  const certDir = path.join(CONFIG.STORAGE_PATH, 'certs');
  const certFile = path.join(certDir, 'cert.pem');
  const keyFile = path.join(certDir, 'key.pem');

  let certOptions: { cert: string; key: string };

  if (fs.existsSync(certFile) && fs.existsSync(keyFile)) {
    certOptions = {
      cert: fs.readFileSync(certFile, 'utf-8'),
      key: fs.readFileSync(keyFile, 'utf-8'),
    };
  } else {
    // Generate self-signed cert
    const selfsigned = require('selfsigned');
    const attrs = [{ name: 'commonName', value: 'ShareHub2026' }];
    const pems = selfsigned.generate(attrs, { days: 365, keySize: 2048 });

    if (!fs.existsSync(certDir)) fs.mkdirSync(certDir, { recursive: true });
    fs.writeFileSync(certFile, pems.cert);
    fs.writeFileSync(keyFile, pems.private);

    certOptions = { cert: pems.cert, key: pems.private };
    console.log('[HTTPS] Self-signed certificate generated');
  }

  const httpsServer = https.createServer(certOptions, app);
  httpsServer.listen(CONFIG.HTTPS_PORT, '0.0.0.0', () => {
    const ip = getLocalIpAddress();
    console.log(`[HTTPS] https://${ip}:${CONFIG.HTTPS_PORT}`);
  });
} catch (err: any) {
  console.warn('[HTTPS] Failed to start:', err.message);
}

// ─── Start PhotoQRbag Workers ─────────────────────────
import { startRetryWorker, startCleanupWorker } from './services/badge-delivery';
startRetryWorker();
startCleanupWorker();
console.log('[Badge] Retry + cleanup workers started');

// ─── Start Folder Watcher ──────────────────────────────
if (CONFIG.WATCH_FOLDER) {
  console.log(`[Watcher] Watching: ${CONFIG.WATCH_FOLDER}`);

  // Scan existing files first
  scanExistingSeries();

  // Then watch for new files
  startFolderWatcher();
} else {
  console.warn('[Watcher] WATCH_FOLDER not set — set it in .env to enable auto-detect');
}

// ─── Graceful Shutdown ─────────────────────────────────
process.on('SIGINT', () => {
  console.log('\n[ShareHub] Shutting down...');
  httpServer.close();
  process.exit(0);
});

process.on('SIGTERM', () => {
  httpServer.close();
  process.exit(0);
});

console.log('');
console.log('[ShareHub] Ready!');
console.log(`  Viewer:     http://localhost:${CONFIG.PORT}/viewer/`);
console.log(`  Face Upload: http://localhost:${CONFIG.PORT}/face-upload/`);
console.log(`  Health:     http://localhost:${CONFIG.PORT}/api/health`);
console.log(`  Register:   http://localhost:${CONFIG.PORT}/register/`);
console.log(`  Badge Scan: http://localhost:${CONFIG.PORT}/badge-scan/`);
console.log('');
