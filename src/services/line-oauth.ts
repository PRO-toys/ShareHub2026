/**
 * LINE Login OAuth 2.1 Service
 * Handles: auth URL generation, code exchange, profile fetch
 * Docs: https://developers.line.biz/en/docs/line-login/integrate-line-login/
 */

import https from 'https';

export interface LineTokenResponse {
  access_token: string;
  expires_in: number;
  id_token: string;
  refresh_token: string;
  scope: string;
  token_type: string;
}

export interface LineProfile {
  userId: string;
  displayName: string;
  pictureUrl: string;
  statusMessage?: string;
}

/**
 * Generate LINE Login authorization URL
 */
export function getAuthUrl(channelId: string, redirectUri: string, state: string): string {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: channelId,
    redirect_uri: redirectUri,
    state,
    scope: 'profile openid',
  });
  return `https://access.line.me/oauth2/v2.1/authorize?${params.toString()}`;
}

/**
 * Exchange authorization code for access token
 */
export async function exchangeToken(
  code: string,
  channelId: string,
  channelSecret: string,
  redirectUri: string
): Promise<LineTokenResponse> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    client_id: channelId,
    client_secret: channelSecret,
  }).toString();

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.line.me',
      path: '/oauth2/v2.1/token',
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body),
      },
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.error) reject(new Error(parsed.error_description || parsed.error));
          else resolve(parsed as LineTokenResponse);
        } catch { reject(new Error('Failed to parse LINE token response')); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

/**
 * Fetch LINE user profile with access token
 */
export async function getProfile(accessToken: string): Promise<LineProfile> {
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.line.me',
      path: '/v2/profile',
      method: 'GET',
      headers: { Authorization: `Bearer ${accessToken}` },
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.message) reject(new Error(parsed.message));
          else resolve(parsed as LineProfile);
        } catch { reject(new Error('Failed to parse LINE profile')); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}
