# ShareHub2026 — Booth Integration Standard
## For Photo Booth Developers

ShareHub2026 accepts photos from any booth program via two methods:

---

## Method 1: HTTP API (Push Mode) — Recommended

### Endpoint
`POST http://{server-ip}:3200/api/booth/upload`

### Headers
```
x-booth-api-key: {your-api-key}
Content-Type: multipart/form-data
```

### Fields
| Field      | Type   | Required | Description                         |
|------------|--------|----------|-------------------------------------|
| photo      | File   | Yes      | Main photo (JPG/PNG/WebP)           |
| clip       | File   | No       | Video clip (MP4/WebM/MOV, max 200MB)|
| boothId    | String | Yes      | Your booth identifier               |
| eventId    | String | No       | Event identifier                    |
| metadata   | String | No       | JSON string with extra data         |

### Example (curl)
```bash
curl -X POST http://192.168.1.100:3200/api/booth/upload \
  -H "x-booth-api-key: sharehub-booth-2026" \
  -F "photo=@photo.jpg" \
  -F "clip=@video.mp4" \
  -F "boothId=booth-A" \
  -F "eventId=event-001"
```

### Response
```json
{
  "sessionId": "sh-intake-xxxxxxxx",
  "token": "xxxxxxxxxxxx",
  "downloadUrl": "https://photobooth-3a08f.web.app/download/xxxxxxxxxxxx",
  "localUrl": "http://192.168.1.100:3200/api/delivery/page/xxxxxxxxxxxx",
  "status": "ready"
}
```

### Status Check
`GET http://{server-ip}:3200/api/booth/status`

---

## Method 2: Folder Drop (Watch Mode)

### Standard Folder Structure
```
{WATCH_FOLDER}/
  {booth-id}/
    {session-id}/
      photo.jpg           <- Main photo (required)
      photo_001.jpg       <- Extra photos (optional)
      clip.mp4            <- Video (optional, .mp4/.webm)
      metadata.json       <- Metadata (optional but recommended)
```

### Atomic Write Pattern (IMPORTANT!)
To prevent corrupt/partial reads, always use this pattern:

1. Create folder with `.tmp_` prefix: `.tmp_session-001/`
2. Copy ALL files into `.tmp_session-001/`
3. When done, RENAME to `session-001/` (atomic operation)

ShareHub automatically ignores folders starting with `.tmp_`

### metadata.json
```json
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
```

---

## Supported File Types
- **Photos**: .jpg, .jpeg, .png, .webp
- **Videos**: .mp4, .webm, .mov
- **Max Size**: 200MB per file (configurable)

## Security
- All API requests require `x-booth-api-key` header
- Booth IDs can be whitelisted via `ALLOWED_BOOTHS` in .env
- Default API key: `sharehub-booth-2026` (change in production!)

## Features
- Automatic QR code generation for instant photo sharing
- PhotoQR overlay (QR embedded on photo corner)
- Cloud sync (Firebase, optional)
- Face recognition search (optional)
- Badge system integration (scan badge → auto-deliver photos)
- Duplicate upload detection (5-minute window)
