# ShareHub2026

**Standalone Photo Sharing Server** — ระบบจัดการและแชร์ภาพจาก Photo Booth อัตโนมัติ พร้อม QR Delivery, Cloud Sync, Face Search และ Badge System

---

## Features

| Feature | Description |
|---------|-------------|
| Folder Watcher | Auto-detect ไฟล์ใหม่จาก Photo Booth (3Acts / MATRIX / Flat format) |
| QR Delivery | สร้าง QR code + short link สำหรับ download ภาพ (หมดอายุ 24 ชม.) |
| Photo Viewer | Web gallery ค้นหาและดูภาพทั้งหมด |
| Cloud Sync | Sync ไป Firebase Storage อัตโนมัติ (optional) |
| Face Search | ค้นหาภาพด้วยใบหน้า (InsightFace integration) |
| Badge System | ลงทะเบียนผู้เข้าร่วมงาน + QR badge + auto-delivery |
| LINE Integration | Login, push notification, auto-send ภาพ |
| HTTPS | Self-signed certificate auto-generated |
| Multi-Booth | รองรับหลาย booth พร้อมกัน (VDO Vintage, MATRIX, 3Acts) |

---

## Requirements

- **Node.js** 18+ ([nodejs.org](https://nodejs.org/))
- **Windows** 10/11 หรือ macOS / Linux
- **Firebase** (optional — สำหรับ cloud sync)

---

## Quick Start

```bash
# 1. Clone
git clone https://github.com/PRO-toys/ShareHub2026.git
cd ShareHub2026

# 2. Install
npm install

# 3. Configure
cp .env.example .env
# แก้ไข .env ตามต้องการ (ดูหัวข้อ Configuration)

# 4. Build & Start
npm run build
npm start
```

หรือ double-click `start.bat` บน Windows

**เปิด browser:**
- Dashboard: http://localhost:3200
- Photo Viewer: http://localhost:3200/viewer/
- HTTPS: https://localhost:3543

---

## Configuration (.env)

```env
# Server ports
PORT=3200                    # HTTP port
HTTPS_PORT=3543              # HTTPS port (self-signed cert)

# Folder Watcher — path ที่ Photo Booth save ไฟล์
# ShareHub จะ watch และ auto-detect ไฟล์ใหม่
WATCH_FOLDER=C:\Users\AI\Desktop\ShareHub2026

# Firebase (optional — ไม่ใส่ก็ทำงานได้แบบ local-only)
FIREBASE_KEY=                # path to firebase-adminsdk.json
FIREBASE_PROJECT_ID=photobooth-3a08f
FIREBASE_BUCKET=photobooth-3a08f.firebasestorage.app

# QR Code settings
QR_BASE_URL=https://photobooth-3a08f.web.app
QR_TOKEN_LENGTH=12           # ความยาว token
QR_EXPIRY_HOURS=24           # หมดอายุ (ชั่วโมง)

# Face Search service
FACE_SERVICE_URL=http://localhost:3101

# Security
ADMIN_API_KEY=sharehub-2026-key   # เปลี่ยนเป็นค่าที่ปลอดภัย
CORS_ORIGINS=                      # comma-separated, ว่าง = allow all

# LINE (optional)
BADGE_LINE_CHANNEL_ID=
BADGE_LINE_CHANNEL_SECRET=
LINE_MESSAGING_TOKEN=

# Email OTP (optional)
SMTP_USER=
SMTP_PASS=
```

---

## User Guide / คู่มือการใช้งาน

### 1. เปิดระบบ

```bash
# Development (auto-reload)
npm run dev

# Production
npm run build && npm start

# Windows
start.bat
```

ระบบจะแสดง:
- HTTP server ที่ port 3200
- HTTPS server ที่ port 3543
- Folder watcher (ถ้าตั้ง WATCH_FOLDER)

### 2. Folder Watcher — Auto-detect ภาพ

ShareHub รองรับ 3 รูปแบบโฟลเดอร์:

| Format | โครงสร้าง | ใช้กับ |
|--------|----------|--------|
| **3Acts** | `BackUp/Series/{id}/PhotoQR/*.jpg` | 3Acts Photo Booth |
| **MATRIX** | `{YYYY-MM-DD_HHmmss}/CAM_*.jpg` + `bullet_time.mp4` | MATRIX Bullet Time |
| **Flat** | `*.jpg`, `*.webm`, `*.mp4` | VDO Vintage Booth, อื่นๆ |

เมื่อมีไฟล์ใหม่เข้ามา ระบบจะ:
1. สร้าง session record ใน database
2. Generate QR code + delivery token
3. Sync ไป Firebase (ถ้าเปิดใช้)
4. Index ใบหน้า (ถ้าเปิดใช้ Face Search)

### 3. Photo Viewer

เปิด http://localhost:3200/viewer/

- ดูภาพทั้งหมดจาก Photo Booth
- ค้นหาด้วย session code
- Filter ตามวันที่ / event
- Preview ภาพแบบ full-size
- รองรับ portrait mode (หมุนจอ)

### 4. QR Delivery

ทุก session จะได้ QR code อัตโนมัติ:
- ผู้ใช้ scan QR → หน้า download
- Download ภาพ/วิดีโอ ได้ทันที
- Track จำนวน downloads + shares
- Token หมดอายุตาม `QR_EXPIRY_HOURS`

### 5. Badge System

สำหรับงาน event — ลงทะเบียนผู้เข้าร่วม:

1. **ลงทะเบียน** ที่ http://localhost:3200/register/
   - LINE Login
   - Email OTP
   - Walk-in (กรอกชื่อ)
2. **รับ QR Badge** — print ออกมาเป็นบัตร
3. **Scan Badge** ที่ Photo Booth → ภาพส่งให้อัตโนมัติ (LINE/Email)

### 6. Face Search

ค้นหาภาพด้วยใบหน้า:
1. Upload selfie ที่ http://localhost:3200/face-upload/
2. ระบบจะค้นหาภาพที่มีใบหน้าตรงกัน
3. ต้องเปิด InsightFace service ที่ port 3101

---

## API Reference

### Sessions
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/sessions` | List all sessions |
| GET | `/api/sessions/search?code=` | Search by session code |

### Delivery
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/delivery/page/:token` | Session data for QR landing |
| GET | `/api/delivery/photo/:token` | Serve photo file |
| GET | `/api/delivery/qr/:filename` | Serve QR image |
| POST | `/api/delivery/done` | Mark delivery completed |
| POST | `/api/delivery/share` | Track social shares |

### Badge
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/badge/register` | Register attendee |
| GET | `/api/badge/stats` | Badge statistics |
| POST | `/api/badge-scan/check` | Check badge at booth |

### System
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/health` | Server health check |
| GET | `/api/network/ip` | Local IP address |
| PUT | `/api/config/watch-folder` | Hot-reload folder watcher |
| GET | `/api/photo-preview?path=` | Resized image preview |
| GET | `/api/clip-preview?path=` | Video streaming (range) |

### Analytics
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/analytics/event` | Track page views |

---

## Booth Integration

### VDO Vintage Booth
```
VDO Vintage (port 7777) ──POST /save──► ShareHub2026 hot folder
                                          └── folder-watcher auto-detect
```
- ไฟล์ `VDV_*_video.webm` + `VDV_*_still.jpg` ถูก detect อัตโนมัติ (Flat format)

### MATRIX Bullet Time
```
MATRIX Mini510 ──save──► Output folder (MATRIX format)
                           └── folder-watcher auto-detect
```
- ไฟล์ `{timestamp}/CAM_*.jpg` + `bullet_time.mp4` ถูก detect อัตโนมัติ

### 3Acts Photo Booth
```
3Acts ──save──► BackUp/Series/{id}/PhotoQR/*.jpg
                  └── folder-watcher auto-detect
```

---

## File Structure

```
ShareHub2026/
├── src/
│   ├── index.ts              # Server entry point
│   ├── app.ts                # Express app + routes
│   ├── config.ts             # Environment configuration
│   ├── db/database.ts        # SQLite schema + queries
│   ├── routes/
│   │   ├── delivery.ts       # QR delivery API
│   │   ├── sessions.ts       # Session management
│   │   ├── badge.ts          # Badge registration
│   │   ├── badge-scan.ts     # Badge scanning
│   │   ├── events.ts         # Event management
│   │   └── face-search.ts    # Face recognition
│   ├── services/
│   │   ├── folder-watcher.ts # Auto-detect booth files
│   │   ├── qr-service.ts     # QR generation + tokens
│   │   ├── firebase.ts       # Cloud sync
│   │   ├── badge-delivery.ts # Badge auto-delivery
│   │   ├── badge-printer.ts  # Thermal printer
│   │   ├── face-service.ts   # InsightFace client
│   │   ├── line-oauth.ts     # LINE login
│   │   ├── line-push.ts      # LINE notifications
│   │   └── otp-email.ts      # Email OTP
│   └── middleware/
│       └── api-key.ts        # Admin API key auth
├── public/
│   ├── viewer/               # Photo gallery UI
│   ├── download/             # QR download landing
│   ├── register/             # Badge registration
│   ├── badge-scan/           # Badge scanner UI
│   ├── face-upload/          # Face search upload
│   └── personal/             # Personal badge page
├── storage/
│   ├── sharehub.sqlite       # Database
│   ├── qr/                   # Generated QR images
│   └── certs/                # SSL certificates
├── .env                      # Configuration
├── start.bat                 # Windows launcher
├── package.json
└── tsconfig.json
```

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| Server ไม่ start | ตรวจ Node.js 18+ ติดตั้งแล้ว, `npm install` ก่อน |
| Folder watcher ไม่ทำงาน | ตรวจ `WATCH_FOLDER` ใน .env ชี้ถูก path |
| QR code ไม่มีภาพ | ตรวจว่า Firebase config ถูกต้อง หรือใช้ local mode |
| Face search ไม่ทำงาน | เปิด InsightFace service ที่ port 3101 |
| Email ส่งไม่ได้ | ตรวจ SMTP_USER/SMTP_PASS ใน .env |
| LINE ไม่ทำงาน | ตรวจ LINE channel credentials ใน .env |
| HTTPS certificate error | ปกติ — self-signed cert, กด "Advanced" → "Proceed" |

---

## Tech Stack

- **Runtime:** Node.js 18+ / TypeScript 5.7
- **Framework:** Express 4.21
- **Database:** SQLite (better-sqlite3) — WAL mode
- **Image Processing:** Sharp 0.33
- **File Watching:** Chokidar 4.0
- **Cloud:** Firebase Admin SDK 13
- **QR:** qrcode 1.5
- **SSL:** selfsigned 2.4

---

## License

MIT

---

<p align="center">
  <strong>ShareHub2026</strong> — Photo Sharing for Events
</p>
