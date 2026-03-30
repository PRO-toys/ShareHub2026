#!/usr/bin/env node
/**
 * ShareHub2026 — Portable Build Script
 * Bundle server + dependencies into a standalone folder
 * Output: dist-portable/ShareHub2026/
 */

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const ROOT = process.cwd();
const OUT = path.join(ROOT, 'dist-portable', 'ShareHub2026');

console.log('');
console.log('  ╔══════════════════════════════════════╗');
console.log('  ║   ShareHub2026 — Portable Build       ║');
console.log('  ╚══════════════════════════════════════╝');
console.log('');

// ─── Step 1: Clean ────────────────────────────────────
console.log('[1/7] Cleaning output...');
if (fs.existsSync(OUT)) fs.rmSync(OUT, { recursive: true });
fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(path.join(OUT, 'storage', 'qr'), { recursive: true });
fs.mkdirSync(path.join(OUT, 'storage', 'intake'), { recursive: true });

// ─── Step 2: esbuild bundle ──────────────────────────
console.log('[2/7] Bundling server with esbuild...');

const externals = [
  'better-sqlite3',
  'sharp',
  '@img/sharp-win32-x64',
  'chokidar',
  'fsevents',
  'multer',
];

const externalArgs = externals.map(e => `--external:${e}`).join(' ');

execSync(
  `npx esbuild src/index.ts --bundle --platform=node --target=node18 --format=cjs ` +
  `--outfile="${path.join(OUT, 'server.js')}" ` +
  `${externalArgs} ` +
  `--minify --sourcemap=external`,
  { cwd: ROOT, stdio: 'inherit' }
);

console.log('   ✓ server.js bundled');

// ─── Step 3: Copy native modules ─────────────────────
console.log('[3/7] Copying native modules...');

const nativeModules = ['better-sqlite3', 'sharp', '@img/sharp-win32-x64'];
const nmSrc = path.join(ROOT, 'node_modules');
const nmDest = path.join(OUT, 'node_modules');

for (const mod of nativeModules) {
  const src = path.join(nmSrc, mod);
  if (!fs.existsSync(src)) {
    console.log(`   ⚠ ${mod} not found, skipping`);
    continue;
  }
  const dest = path.join(nmDest, mod);
  copyDirSync(src, dest);
  console.log(`   ✓ ${mod}`);
}

// Copy multer + dependencies
const multerDeps = ['multer', 'busboy', 'streamsearch', 'xtend', 'append-field',
  'concat-stream', 'buffer-from', 'typedarray', 'type-is', 'media-typer',
  'mime-types', 'mime-db', 'content-disposition', 'content-type', 'mkdirp',
  'object-assign', 'on-finished', 'ee-first'];
for (const mod of multerDeps) {
  const src = path.join(nmSrc, mod);
  if (!fs.existsSync(src)) continue;
  const dest = path.join(nmDest, mod);
  if (!fs.existsSync(dest)) {
    copyDirSync(src, dest);
  }
}
console.log('   ✓ multer + deps');

// Copy chokidar + dependencies
const chokidarDeps = ['chokidar', 'readdirp', 'braces', 'picomatch', 'fill-range',
  'to-regex-range', 'is-number', 'anymatch', 'normalize-path', 'glob-parent',
  'is-glob', 'is-extglob'];
for (const mod of chokidarDeps) {
  const src = path.join(nmSrc, mod);
  if (!fs.existsSync(src)) continue;
  const dest = path.join(nmDest, mod);
  if (!fs.existsSync(dest)) {
    copyDirSync(src, dest);
  }
}
console.log('   ✓ chokidar + deps');

// Copy bindings + file-uri-to-path (needed by better-sqlite3)
for (const mod of ['bindings', 'file-uri-to-path', 'prebuild-install', 'node-addon-api']) {
  const src = path.join(nmSrc, mod);
  if (!fs.existsSync(src)) continue;
  copyDirSync(src, path.join(nmDest, mod));
}

// ─── Step 4: Copy public pages ───────────────────────
console.log('[4/7] Copying public pages...');
copyDirSync(path.join(ROOT, 'public'), path.join(OUT, 'public'));
console.log('   ✓ viewer, download, face-upload, dashboard');

// ─── Step 5: Create .env.example ─────────────────────
console.log('[5/7] Creating config files...');
fs.copyFileSync(
  path.join(ROOT, '.env.example'),
  path.join(OUT, '.env.example')
);

// Create default .env
fs.writeFileSync(path.join(OUT, '.env'), `# ShareHub2026 Configuration
PORT=3200
HTTPS_PORT=3543
WATCH_FOLDER=
QR_BASE_URL=https://photobooth-3a08f.web.app
QR_TOKEN_LENGTH=12
QR_EXPIRY_HOURS=24
FACE_SERVICE_URL=http://localhost:3101

# Booth Intake (Push Mode API)
INTAKE_FOLDER=./storage/intake
BOOTH_API_KEY=sharehub-booth-2026
ALLOWED_BOOTHS=
MAX_UPLOAD_SIZE=200
`);
console.log('   ✓ .env + .env.example');

// ─── Step 6: Create start.bat ────────────────────────
console.log('[6/7] Creating launcher...');
fs.writeFileSync(path.join(OUT, 'start.bat'), `@echo off
title ShareHub 2026
cd /d "%~dp0"

echo.
echo   ShareHub 2026 - Photo Sharing Server
echo   =====================================
echo.

:: Check Node.js
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo ERROR: Node.js not found!
    echo Download from: https://nodejs.org/
    pause
    exit /b 1
)

:: Check .env
if not exist ".env" (
    echo First run - creating .env from template...
    copy .env.example .env >nul
    echo.
    echo IMPORTANT: Edit .env and set WATCH_FOLDER
    echo Then restart this script.
    echo.
    notepad .env
    pause
    exit /b 0
)

echo Starting server...
node server.js
pause
`);

// Create stop.bat
fs.writeFileSync(path.join(OUT, 'stop.bat'), `@echo off
echo Stopping ShareHub2026...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3200" ^| findstr "LISTENING"') do (
    taskkill /F /PID %%a 2>nul
)
echo Done.
timeout /t 2
`);

console.log('   ✓ start.bat + stop.bat');

// ─── Step 7: Create BOOTH-STANDARD.md ────────────────
console.log('[7/8] Creating Booth Integration Standard...');
fs.writeFileSync(path.join(OUT, 'BOOTH-STANDARD.md'), `# ShareHub2026 — Booth Integration Standard
## For Photo Booth Developers

ShareHub2026 accepts photos from any booth program via two methods:

---

## Method 1: HTTP API (Push Mode) — Recommended

### Endpoint
\`POST http://{server-ip}:3200/api/booth/upload\`

### Headers
\`\`\`
x-booth-api-key: {your-api-key}
Content-Type: multipart/form-data
\`\`\`

### Fields
| Field      | Type   | Required | Description                         |
|------------|--------|----------|-------------------------------------|
| photo      | File   | Yes      | Main photo (JPG/PNG/WebP)           |
| clip       | File   | No       | Video clip (MP4/WebM/MOV, max 200MB)|
| boothId    | String | Yes      | Your booth identifier               |
| eventId    | String | No       | Event identifier                    |
| metadata   | String | No       | JSON string with extra data         |

### Example (curl)
\`\`\`bash
curl -X POST http://192.168.1.100:3200/api/booth/upload \\
  -H "x-booth-api-key: sharehub-booth-2026" \\
  -F "photo=@photo.jpg" \\
  -F "clip=@video.mp4" \\
  -F "boothId=booth-A" \\
  -F "eventId=event-001"
\`\`\`

### Response
\`\`\`json
{
  "sessionId": "sh-intake-xxxxxxxx",
  "token": "xxxxxxxxxxxx",
  "downloadUrl": "https://photobooth-3a08f.web.app/download/xxxxxxxxxxxx",
  "localUrl": "http://192.168.1.100:3200/api/delivery/page/xxxxxxxxxxxx",
  "status": "ready"
}
\`\`\`

### Status Check
\`GET http://{server-ip}:3200/api/booth/status\`

---

## Method 2: Folder Drop (Watch Mode)

### Standard Folder Structure
\`\`\`
{WATCH_FOLDER}/
  {booth-id}/
    {session-id}/
      photo.jpg           <- Main photo (required)
      photo_001.jpg       <- Extra photos (optional)
      clip.mp4            <- Video (optional, .mp4/.webm)
      metadata.json       <- Metadata (optional but recommended)
\`\`\`

### Atomic Write Pattern (IMPORTANT!)
To prevent corrupt/partial reads, always use this pattern:

1. Create folder with \`.tmp_\` prefix: \`.tmp_session-001/\`
2. Copy ALL files into \`.tmp_session-001/\`
3. When done, RENAME to \`session-001/\` (atomic operation)

ShareHub automatically ignores folders starting with \`.tmp_\`

### metadata.json
\`\`\`json
{
  "boothId": "booth-A",
  "boothName": "Photo Booth Station 1",
  "sessionId": "20260329-210641",
  "eventId": "event-001",
  "capturedAt": "2026-03-29T21:06:41+07:00",
  "photoCount": 4,
  "hasClip": true,
  "primaryPhoto": "photo.jpg",
  "attendees": ["badge-token-1", "badge-token-2"]
}
\`\`\`

---

## Supported File Types
- **Photos**: .jpg, .jpeg, .png, .webp
- **Videos**: .mp4, .webm, .mov
- **Max Size**: 200MB per file (configurable)

## Security
- All API requests require \`x-booth-api-key\` header
- Booth IDs can be whitelisted via \`ALLOWED_BOOTHS\` in .env
- Default API key: \`sharehub-booth-2026\` (change in production!)

## Features
- Automatic QR code generation for instant photo sharing
- PhotoQR overlay (QR embedded on photo corner)
- Cloud sync (Firebase, optional)
- Face recognition search (optional)
- Badge system integration (scan badge → auto-deliver photos)
- Duplicate upload detection (5-minute window)
`);
console.log('   ✓ BOOTH-STANDARD.md');

// ─── Step 8: Summary ─────────────────────────────────
console.log('[8/8] Calculating size...');
const totalSize = getDirSize(OUT);
const sizeMB = (totalSize / 1024 / 1024).toFixed(1);

console.log('');
console.log('  ╔══════════════════════════════════════╗');
console.log('  ║         BUILD COMPLETE ✓              ║');
console.log('  ╚══════════════════════════════════════╝');
console.log('');
console.log(`  Output: ${OUT}`);
console.log(`  Size:   ${sizeMB} MB`);
console.log('');
console.log('  To deploy:');
console.log('  1. Copy ShareHub2026/ folder to target machine');
console.log('  2. Install Node.js 18+ on target machine');
console.log('  3. Edit .env → set WATCH_FOLDER');
console.log('  4. Double-click start.bat');
console.log('');

// ─── Helpers ──────────────────────────────────────────

function copyDirSync(src, dest) {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      // Skip unnecessary folders
      if (['test', 'tests', '__tests__', 'docs', 'example', 'examples', '.github'].includes(entry.name)) continue;
      copyDirSync(srcPath, destPath);
    } else {
      // Skip unnecessary files
      if (['.md', '.ts', '.map', '.tsbuildinfo'].some(ext => entry.name.endsWith(ext))) continue;
      if (entry.name === '.npmignore' || entry.name === '.editorconfig') continue;
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function getDirSize(dir) {
  let size = 0;
  if (!fs.existsSync(dir)) return 0;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      size += getDirSize(fullPath);
    } else {
      size += fs.statSync(fullPath).size;
    }
  }
  return size;
}
