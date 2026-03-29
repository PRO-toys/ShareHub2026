/**
 * LINE Messaging API Push Notifications
 * Queued: 1 message per second (LINE rate limit)
 */

import https from 'https';
import { CONFIG } from '../config';
import { getBadgeConfig } from '../db/database';

interface PushMessage {
  lineUserId: string;
  badgeToken: string;
  eventId: string;
}

const pushQueue: PushMessage[] = [];
let processing = false;

/**
 * Queue a photo push notification
 */
export async function sendPhotoPush(lineUserId: string, badgeToken: string, eventId: string): Promise<void> {
  const token = CONFIG.LINE_MESSAGING_TOKEN || (getBadgeConfig(eventId).lineMessagingToken as string);
  if (!token) return; // Not configured

  pushQueue.push({ lineUserId, badgeToken, eventId });
  processQueue(token);
}

function processQueue(messagingToken: string): void {
  if (processing || pushQueue.length === 0) return;
  processing = true;

  const interval = setInterval(() => {
    const msg = pushQueue.shift();
    if (!msg) {
      clearInterval(interval);
      processing = false;
      return;
    }

    const personalUrl = `${CONFIG.QR_BASE_URL}/personal/?token=${msg.badgeToken}`;

    const body = JSON.stringify({
      to: msg.lineUserId,
      messages: [{
        type: 'flex',
        altText: 'Your photos are ready!',
        contents: {
          type: 'bubble',
          body: {
            type: 'box',
            layout: 'vertical',
            contents: [
              { type: 'text', text: 'Your photos are ready!', weight: 'bold', size: 'lg', color: '#C9A24A' },
              { type: 'text', text: 'Tap to view, download, and share your photos.', size: 'sm', color: '#666666', margin: 'md', wrap: true },
            ],
          },
          footer: {
            type: 'box',
            layout: 'vertical',
            contents: [{
              type: 'button',
              action: { type: 'uri', label: 'View Photos', uri: personalUrl },
              style: 'primary',
              color: '#C9A24A',
            }],
          },
        },
      }],
    });

    const req = https.request({
      hostname: 'api.line.me',
      path: '/v2/bot/message/push',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${messagingToken}`,
        'Content-Length': Buffer.byteLength(body),
      },
    }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        if (res.statusCode !== 200) {
          console.warn(`[LINE Push] Error ${res.statusCode}: ${data}`);
        } else {
          console.log(`[LINE Push] Sent to ${msg.lineUserId}`);
        }
      });
    });

    req.on('error', (err) => {
      console.warn(`[LINE Push] Request failed: ${err.message}`);
    });

    req.write(body);
    req.end();
  }, 1000); // 1 message per second
}
