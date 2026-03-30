# PhotoQRbag — คู่มือการใช้งาน

## สารบัญ
1. [ภาพรวมระบบ](#1-ภาพรวมระบบ)
2. [โครงสร้างระบบ](#2-โครงสร้างระบบ)
3. [การติดตั้ง](#3-การติดตั้ง)
4. [การตั้งค่า](#4-การตั้งค่า)
5. [Journey Flow — ขั้นตอนการใช้งาน](#5-journey-flow)
6. [หน้าเว็บต่างๆ](#6-หน้าเว็บต่างๆ)
7. [API Reference](#7-api-reference)
8. [การเชื่อมต่อกับ Booth](#8-การเชื่อมต่อกับ-booth)
9. [Troubleshooting](#9-troubleshooting)

---

## 1. ภาพรวมระบบ

**PhotoQRbag** เป็นระบบลงทะเบียนแขกและส่งภาพอัตโนมัติสำหรับงานอีเวนต์ที่มี Photo Booth

### แนวคิดหลัก
- แขกลงทะเบียน → ได้ Badge QR ส่วนตัว
- Operator สแกน Badge ของแขกก่อนถ่ายรูป
- หลังถ่ายรูปเสร็จ → ระบบส่งภาพเข้า Personal Page ของแขกทุกคนที่ถูกสแกนอัตโนมัติ
- แขกเปิดดูภาพ + ดาวน์โหลดได้ตลอดเวลาผ่าน QR ส่วนตัว

### จุดเด่น
- **ไม่ต้อง Add Photo ด้วยตัวเอง** — ระบบส่งให้อัตโนมัติ
- **รองรับถ่ายเป็นกลุ่ม** — สแกน Badge หลายคน → ภาพเข้าทุกคน
- **3 วิธีลงทะเบียน** — LINE Login, Email OTP, Walk-in (ชื่อ+เบอร์)
- **Lucky Draw** — สุ่มรางวัลจากผู้ลงทะเบียน
- **LINE Push** — แจ้งเตือนเมื่อภาพพร้อม (ถ้าตั้งค่า)
- **Standalone** — ทำงานอิสระ ไม่ต้องแก้ไขโค้ด Booth เดิม

---

## 2. โครงสร้างระบบ

### Architecture Diagram

```
┌──────────────┐     ┌───────────────────────────┐     ┌──────────────┐
│  Guest Phone │     │      ShareHub2026          │     │  Photo Booth │
│              │     │      (Port 3200)           │     │  (3ActsBooth │
│ /register/   │────▶│                            │◀────│   or MATRIX) │
│ /personal/   │     │  ┌─────────┐ ┌──────────┐ │     │              │
│              │     │  │ SQLite  │ │ Folder   │ │     │  Webhook or  │
└──────────────┘     │  │ Database│ │ Watcher  │ │     │  Folder Drop │
                     │  └─────────┘ └──────────┘ │     └──────────────┘
┌──────────────┐     │  ┌─────────┐ ┌──────────┐ │
│  Operator    │     │  │ Badge   │ │ LINE     │ │
│  Phone       │────▶│  │ Delivery│ │ Push     │ │
│ /badge-scan/ │     │  └─────────┘ └──────────┘ │
└──────────────┘     └───────────────────────────┘
```

### ไฟล์สำคัญ

```
ShareHub2026/
├── src/
│   ├── index.ts              # Entry point — start server + workers
│   ├── app.ts                # Express app + route mounting
│   ├── config.ts             # Environment config
│   ├── db/
│   │   └── database.ts       # SQLite schema (12 tables) + helpers
│   ├── routes/
│   │   ├── badge.ts          # 14 endpoints — register, personal, print, admin
│   │   ├── badge-scan.ts     # 5 endpoints — batch scan system
│   │   ├── booth-intake.ts   # Booth API — file upload + metadata webhook
│   │   ├── sessions.ts       # Session management
│   │   ├── delivery.ts       # QR delivery + download pages
│   │   └── events.ts         # Event management
│   ├── services/
│   │   ├── badge-delivery.ts # Auto-link + retry worker + cleanup worker
│   │   ├── badge-printer.ts  # Badge PNG generator (Sharp)
│   │   ├── line-oauth.ts     # LINE Login OAuth 2.1
│   │   ├── line-push.ts      # LINE Messaging API push (rate-limited)
│   │   ├── otp-email.ts      # Email OTP via Nodemailer
│   │   ├── folder-watcher.ts # Watch folder for new sessions
│   │   ├── qr-service.ts     # QR code generation
│   │   └── firebase.ts       # Firebase cloud sync
│   ├── middleware/
│   │   ├── api-key.ts        # Admin/Operator API key auth
│   │   └── booth-auth.ts     # Booth API key auth
│   └── types/
│       └── register.ts       # TypeScript types
├── public/
│   ├── index.html            # Dashboard (config + stats + lucky draw)
│   ├── register/index.html   # Guest registration page
│   ├── badge-scan/index.html # Operator QR scanner
│   ├── personal/index.html   # Personal photo gallery
│   ├── badge-preview/index.html # Badge print preview
│   ├── viewer/               # Photo viewer (16:9 + 9:16)
│   └── download/             # QR download landing
├── storage/
│   ├── sharehub.sqlite       # Database file
│   ├── qr/                   # Generated QR images
│   ├── selfies/              # Guest selfie photos
│   └── intake/               # Booth uploaded files
├── scripts/
│   └── build-portable.mjs    # Portable build script
└── docs/
    └── PhotoQRbag-Manual-TH.md  # This file
```

### Database Tables

| Table | Purpose |
|-------|---------|
| `register_users` | ผู้ลงทะเบียน (LINE/Email/Walk-in) |
| `otp_codes` | OTP 6 หลักสำหรับ Email verification |
| `session_badges` | การเชื่อมระหว่าง session กับ badge user |
| `pending_badges` | Batch scan queue (SQLite-backed) |
| `badge_config` | Config per event (LINE/SMTP/features) |
| `lucky_draw_rounds` | ผล Lucky Draw |
| `sessions` | Photo sessions |
| `qr_deliveries` | QR codes + download links |
| `events` | Events |
| `booth_uploads` | Booth upload log (dedup) |
| `cloud_sync_queue` | Firebase sync queue |
| `analytics_events` | Usage analytics |

---

## 3. การติดตั้ง

### วิธีที่ 1: Portable Build (แนะนำ)

1. คัดลอกโฟลเดอร์ `dist-portable/ShareHub2026/` ไปยังเครื่องเป้าหมาย
2. ติดตั้ง Node.js 18+ (https://nodejs.org/)
3. แก้ไข `.env` → ตั้ง `WATCH_FOLDER` ชี้ไปที่โฟลเดอร์ Output ของ Booth
4. Double-click `start.bat`

### วิธีที่ 2: Development Mode

```bash
cd ShareHub2026
npm install
npm run dev     # ts-node-dev with hot reload
```

### วิธีที่ 3: Production Build

```bash
cd ShareHub2026
npm install
npm run build   # TypeScript → dist/
npm start       # node dist/index.js
```

---

## 4. การตั้งค่า

### ไฟล์ .env

```env
# Server
PORT=3200
HTTPS_PORT=3543

# Watch Folder (for auto-detect sessions)
WATCH_FOLDER=C:\Users\...\Desktop\01

# Badge System
ADMIN_API_KEY=sharehub-2026-key    # API key สำหรับ admin/operator

# LINE Login (optional)
BADGE_LINE_CHANNEL_ID=             # จาก LINE Developer Console
BADGE_LINE_CHANNEL_SECRET=

# LINE Push Notification (optional)
LINE_MESSAGING_TOKEN=              # จาก LINE Messaging API

# Email OTP (optional)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your@gmail.com
SMTP_PASS=xxxx-xxxx-xxxx-xxxx     # Gmail App Password
```

### ตั้งค่าผ่าน Dashboard

1. เปิด `http://localhost:3200/`
2. ไปที่ section **PhotoQRbag Config**
3. ใส่ Event ID → กด **Load**
4. กรอก LINE/SMTP ตามต้องการ
5. เลือก method ที่จะเปิด (LINE / Email / Walk-in)
6. กด **Save Config**

### LINE Login Setup (ทำครั้งเดียว)

1. ไปที่ https://developers.line.biz/console/
2. Create Provider → Create Channel → **LINE Login**
3. ได้: Channel ID + Channel Secret
4. Set Callback URL: `https://{your-domain}/api/badge/register/line-callback`
5. ใส่ค่าใน Dashboard Config

### Gmail App Password

1. ไปที่ https://myaccount.google.com/apppasswords
2. เลือก App: Mail, Device: Other → ใส่ชื่อ "PhotoQRbag"
3. Copy 16-digit password → ใส่ใน `SMTP_PASS`

---

## 5. Journey Flow

### ก่อนงาน (Admin Setup)

```
Admin → เปิด Dashboard (http://localhost:3200/)
  → ตั้ง Watch Folder ชี้ไปที่โฟลเดอร์ Booth
  → ตั้ง Badge Config (LINE/Email/Walk-in)
  → สร้าง Event QR (URL: http://{ip}:3200/register/?eventId=xxx)
  → พิมพ์ Event QR ติดหน้างาน
```

### ระหว่างงาน (Guest + Operator)

```
Step 1: แขก scan Event QR
  → เลือก LINE Login / Email OTP / Walk-in
  → ลงทะเบียนสำเร็จ → ถ่าย Selfie (optional)
  → ได้ Personal QR + Badge Token
  → กดปุ่ม "Print Badge" → พิมพ์ Badge QR

Step 2: แขกไปถ่ายรูปที่ Booth
  → Operator เปิด /badge-scan/ บนมือถือ
  → กด "New Batch"
  → สแกน Badge QR ของแขกทุกคนในกลุ่ม
  → กด "Lock" (Ready)

Step 3: Booth ถ่ายรูป
  → ถ่ายเสร็จ → render → ส่ง session เข้า ShareHub
  → ระบบ auto-link: จับคู่ locked batch (FIFO) กับ session
  → ภาพเข้า Personal Page ของทุกคนในกลุ่ม

Step 4: แขกดูภาพ
  → scan Personal QR → เปิด /personal/{token}
  → เห็นภาพทั้งหมด + download + share
  → Auto-refresh ทุก 30 วินาที
```

### Batch Flow Diagram

```
Operator: New Batch → Scan A → Scan B → Scan C → Lock
                                                    ↓
Booth: ถ่ายรูป → render → session created ─────────→ auto-link
                                                    ↓
                                            A, B, C ได้ภาพ!
```

### หลังงาน (Admin)

```
Admin → Dashboard → Badge Stats
  → ดูจำนวนผู้ลงทะเบียน (LINE/Email/Walk-in)
  → Lucky Draw: ใส่ชื่อ Round + Prize → กด Draw!
  → ผู้ชนะเห็น prize ใน Personal Page
```

---

## 6. หน้าเว็บต่างๆ

| URL | ใครใช้ | Description |
|-----|--------|-------------|
| `/` | Admin | Dashboard — config, stats, lucky draw |
| `/register/` | Guest | หน้าลงทะเบียน (LINE/Email/Walk-in + Selfie) |
| `/badge-scan/` | Operator | QR scanner + Batch management |
| `/personal/{token}` | Guest | หน้าส่วนตัว — ภาพ, download, lucky draw |
| `/badge-preview/{token}` | Guest | Preview + Print badge |
| `/viewer/` | Everyone | Photo gallery (16:9) |
| `/viewer/portrait/` | Everyone | Photo gallery (9:16) |

---

## 7. API Reference

### Registration (Public)

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/badge/register/line-auth-url` | สร้าง LINE Login URL |
| GET | `/api/badge/register/line-callback` | LINE callback |
| POST | `/api/badge/register/email-otp` | ส่ง OTP ไป email |
| POST | `/api/badge/register/verify-otp` | ตรวจ OTP |
| POST | `/api/badge/register/walk-in` | ลงทะเบียนด้วยชื่อ+เบอร์ |
| POST | `/api/badge/selfie` | Upload selfie |
| GET | `/api/badge/personal/{token}` | ข้อมูล Personal Page |
| GET | `/api/badge/print/{token}` | Badge PNG image |
| POST | `/api/badge/add-photo/{token}` | เพิ่ม session เข้า collection (manual) |

### Batch Scan (Requires API Key)

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/badge-scan/batch/new` | สร้าง batch ใหม่ |
| POST | `/api/badge-scan/scan` | สแกน badge เข้า batch |
| POST | `/api/badge-scan/batch/lock/{batchId}` | Lock batch (ready for link) |
| GET | `/api/badge-scan/pending/{boothId}` | ดู pending batches |
| POST | `/api/badge-scan/link` | Manual link batch→session |

### Admin (Requires API Key)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/badge/users/{eventId}` | List users |
| GET | `/api/badge/stats/{eventId}` | Registration stats |
| POST | `/api/badge/lucky-draw/{eventId}` | Run lucky draw |
| GET | `/api/badge/lucky-draw/{eventId}` | Draw history |
| GET/PUT | `/api/badge/config/{eventId}` | Badge config |

### Booth Integration

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/booth/upload` | Upload photo (multipart) |
| POST | `/api/booth/upload-meta` | Metadata webhook (shared disk) |
| GET | `/api/booth/status` | Server status |

### Authentication

Admin/Operator routes ต้องส่ง header:
```
x-api-key: sharehub-2026-key
```

Booth routes ต้องส่ง header:
```
x-booth-api-key: sharehub-booth-2026
```

---

## 8. การเชื่อมต่อกับ Booth

### วิธี A: Folder Watcher (ง่ายสุด)

1. ตั้ง `WATCH_FOLDER` ให้ชี้ไป Output/BackUp ของ Booth
2. Booth ถ่ายรูปและ render ตามปกติ
3. ShareHub detect ภาพใหม่อัตโนมัติ

**รองรับ format:**
- **3ActsBooth**: `BackUp/Series/SER_XXXXXX/`
- **MATRIX**: `YYYY-MM-DD_HHmmss/`

### วิธี B: HTTP API (Push Mode)

Booth ส่ง HTTP POST หลัง render เสร็จ:

```bash
curl -X POST http://192.168.1.100:3200/api/booth/upload \
  -H "x-booth-api-key: sharehub-booth-2026" \
  -F "photo=@rendered-photo.jpg" \
  -F "boothId=booth-A" \
  -F "eventId=event-001"
```

### วิธี C: Webhook (3ActsBooth)

เพิ่ม env ใน 3ActsBooth:
```env
SHAREHUB_URL=http://192.168.1.100:3200
SHAREHUB_BOOTH_KEY=sharehub-booth-2026
BOOTH_ID=booth-1
```

3ActsBooth จะส่ง metadata ไป ShareHub หลัง pipeline เสร็จอัตโนมัติ

---

## 9. Troubleshooting

### Badge scan แล้วไม่ link กับ session

**สาเหตุ:** Batch ยังไม่ได้ Lock
**แก้ไข:** ต้องกด Lock (Ready) ก่อนถ่ายรูป — ระบบ link เฉพาะ batch ที่ locked

### ภาพไม่เข้า Personal Page

**สาเหตุ:** Batch หมดอายุ (15 นาที)
**แก้ไข:** สร้าง batch ใหม่ แล้วสแกนอีกครั้ง

### LINE Login ไม่ทำงาน

**เช็ค:**
1. Channel ID + Secret ถูกต้อง?
2. Callback URL ตรงกับที่ตั้งใน LINE Developer Console?
3. Channel เป็น Published status?

### Email OTP ไม่ส่ง

**เช็ค:**
1. SMTP credentials ถูกต้อง?
2. Gmail: ต้องใช้ App Password (ไม่ใช่ password ปกติ)
3. Port 587 ถูก block โดย firewall?

### Retry Worker ไม่ทำงาน

ดู log: `[Badge] Retry worker: X badges retried`
- Worker ทำงานทุก 30 วินาที
- Max retry = 3 ครั้ง
- ถ้า retry เกิน 3 → ไม่ลองอีก

### Portable Build ไม่ start

1. ตรวจว่า Node.js 18+ ติดตั้งแล้ว: `node --version`
2. ตรวจว่า `.env` มี `WATCH_FOLDER` ที่ถูกต้อง
3. ดู error ใน terminal ที่ start.bat เปิด

---

## Production Checklist

- [ ] เปลี่ยน `ADMIN_API_KEY` จาก default
- [ ] เปลี่ยน `BOOTH_API_KEY` จาก default
- [ ] ตั้ง `WATCH_FOLDER` ให้ตรงกับ Booth output
- [ ] ตั้ง LINE Channel ID/Secret (ถ้าใช้ LINE Login)
- [ ] ตั้ง LINE Messaging Token (ถ้าต้องการ push notification)
- [ ] ตั้ง SMTP credentials (ถ้าใช้ Email OTP)
- [ ] ทดสอบ Walk-in register → Badge print → Badge scan → Photo link
- [ ] ทดสอบ Lucky Draw
- [ ] Backup `storage/sharehub.sqlite` เป็นระยะ
