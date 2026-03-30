import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { CONFIG } from './config';

// Routes
import deliveryRouter from './routes/delivery';
import sessionsRouter from './routes/sessions';
import eventsRouter from './routes/events';
import faceSearchRouter from './routes/face-search';
import badgeRouter from './routes/badge';
import badgeScanRouter from './routes/badge-scan';
import boothIntakeRouter from './routes/booth-intake';

const app = express();

// ─── Middleware ─────────────────────────────────────────
app.use(cors({
  origin: CONFIG.CORS_ORIGINS ? CONFIG.CORS_ORIGINS.split(',') : true,
  credentials: true,
}));

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Private Network Access (Chrome 104+)
app.use((_req, res, next) => {
  res.setHeader('Access-Control-Allow-Private-Network', 'true');
  next();
});

// ─── API Routes ────────────────────────────────────────
app.use('/api/delivery', deliveryRouter);
app.use('/api/sessions', sessionsRouter);
app.use('/api/events', eventsRouter);
app.use('/api/face', faceSearchRouter);
app.use('/api/badge', badgeRouter);
app.use('/api/badge-scan', badgeScanRouter);
app.use('/api/booth', boothIntakeRouter);

// ─── Photo/Clip preview (top-level for viewer compatibility) ──
app.get('/api/photo-preview', (req, res) => {
  const filePath = req.query.path as string;
  if (!filePath) return res.status(400).json({ error: 'path required' });

  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved)) return res.status(404).json({ error: 'File not found' });

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
    } catch { /* fallback */ }
  }

  res.sendFile(resolved);
});

app.get('/api/clip-preview', (req, res) => {
  const filePath = req.query.path as string;
  if (!filePath) return res.status(400).json({ error: 'path required' });

  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved)) return res.status(404).json({ error: 'File not found' });

  // Range request support for video streaming
  const stat = fs.statSync(resolved);
  const range = req.headers.range;

  if (range) {
    const parts = range.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : stat.size - 1;
    const chunkSize = end - start + 1;

    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${stat.size}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunkSize,
      'Content-Type': 'video/mp4',
    });
    fs.createReadStream(resolved, { start, end }).pipe(res);
  } else {
    res.sendFile(resolved);
  }
});

// ─── Network IP ────────────────────────────────────────
app.get('/api/network/ip', (_req, res) => {
  const { getLocalIpAddress } = require('./services/qr-service');
  res.json({ ip: getLocalIpAddress(), port: CONFIG.PORT });
});

// ─── Static Pages ──────────────────────────────────────
const publicDir = path.join(__dirname, '..', 'public');
if (fs.existsSync(publicDir)) {
  // Viewer
  app.use('/viewer', express.static(path.join(publicDir, 'viewer')));
  app.get('/viewer/*', (_req, res) => {
    res.sendFile(path.join(publicDir, 'viewer', 'index.html'));
  });

  // Portrait viewer
  app.use('/viewer/portrait', express.static(path.join(publicDir, 'viewer', 'portrait')));

  // Download landing
  app.use('/download', express.static(path.join(publicDir, 'download')));
  app.get('/download/*', (_req, res) => {
    res.sendFile(path.join(publicDir, 'download', 'index.html'));
  });

  // Face upload
  app.use('/face-upload', express.static(path.join(publicDir, 'face-upload')));

  // PhotoQRbag pages
  app.use('/register', express.static(path.join(publicDir, 'register')));
  app.use('/badge-scan', express.static(path.join(publicDir, 'badge-scan')));
  app.use('/personal', express.static(path.join(publicDir, 'personal')));
  app.use('/badge-preview', express.static(path.join(publicDir, 'badge-preview')));

  // Root — dashboard/config page
  app.get('/', (_req, res) => {
    res.sendFile(path.join(publicDir, 'index.html'));
  });
}

// ─── Browse API (list directories for folder picker) ──
app.get('/api/config/browse', (req, res) => {
  let targetPath = (req.query.path as string) || '';

  // Default: list drives on Windows, / on Unix
  if (!targetPath) {
    if (process.platform === 'win32') {
      // List available drives
      try {
        const drives: string[] = [];
        for (let i = 65; i <= 90; i++) {
          const drive = String.fromCharCode(i) + ':\\';
          if (fs.existsSync(drive)) drives.push(drive);
        }
        return res.json({ path: '', dirs: drives, isRoot: true });
      } catch {
        return res.json({ path: '', dirs: ['C:\\'], isRoot: true });
      }
    }
    targetPath = '/';
  }

  const resolved = path.resolve(targetPath);
  if (!fs.existsSync(resolved)) {
    return res.status(404).json({ error: 'Path not found' });
  }

  try {
    const stat = fs.statSync(resolved);
    if (!stat.isDirectory()) {
      return res.status(400).json({ error: 'Not a directory' });
    }

    const entries = fs.readdirSync(resolved, { withFileTypes: true });
    const dirs = entries
      .filter(e => {
        if (!e.isDirectory()) return false;
        // Hide system/hidden folders
        if (e.name.startsWith('.') || e.name.startsWith('$')) return false;
        if (['node_modules', 'Windows', 'ProgramData', 'Recovery'].includes(e.name)) return false;
        return true;
      })
      .map(e => e.name)
      .sort();

    // Check if this folder has BackUp/Series/ (3Acts format)
    const has3Acts = fs.existsSync(path.join(resolved, 'BackUp', 'Series'));
    // Check if has MATRIX sessions
    const hasMatrix = dirs.some(d => /^\d{4}-\d{2}-\d{2}_\d{6}$/.test(d));

    res.json({
      path: resolved,
      parent: path.dirname(resolved),
      dirs,
      has3Acts,
      hasMatrix,
      isRoot: resolved === path.parse(resolved).root,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Config API (save watch folder + hot reload) ──────
app.put('/api/config/watch-folder', (req, res) => {
  const { path: folderPath } = req.body;
  if (!folderPath) return res.status(400).json({ error: 'path required' });

  if (!fs.existsSync(folderPath)) {
    return res.status(400).json({ error: 'Folder not found: ' + folderPath });
  }

  // Update .env file
  const envPath = path.join(process.cwd(), '.env');
  let content = '';
  if (fs.existsSync(envPath)) {
    content = fs.readFileSync(envPath, 'utf-8');
  }

  if (content.includes('WATCH_FOLDER=')) {
    content = content.replace(/WATCH_FOLDER=.*/g, `WATCH_FOLDER=${folderPath}`);
  } else {
    content += `\nWATCH_FOLDER=${folderPath}\n`;
  }

  fs.writeFileSync(envPath, content, 'utf-8');

  // Hot reload: update CONFIG + restart watcher
  CONFIG.WATCH_FOLDER = folderPath;
  const { startFolderWatcher, scanExistingSeries } = require('./services/folder-watcher');
  try {
    scanExistingSeries();
    startFolderWatcher();
    res.json({ ok: true, message: 'Saved & watcher started!', hotReload: true });
  } catch (err: any) {
    res.json({ ok: true, message: 'Saved. Watcher error: ' + err.message, hotReload: false });
  }
});

// ─── Health Check ──────────────────────────────────────
app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    name: 'ShareHub2026',
    version: '1.0.0',
    uptime: process.uptime(),
    watchFolder: CONFIG.WATCH_FOLDER || '(not set)',
  });
});

// ─── Error Handler ─────────────────────────────────────
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('[Error]', err.message);
  res.status(500).json({ error: 'Internal server error' });
});

export default app;
