import { Request, Response, NextFunction } from 'express';
import { CONFIG } from '../config';

/**
 * Booth API key authentication middleware.
 * Validates x-booth-api-key header and boothId against whitelist.
 */
export function boothAuth(req: Request, res: Response, next: NextFunction): void {
  const apiKey = req.headers['x-booth-api-key'] as string || req.query.boothApiKey as string;

  if (!apiKey || apiKey !== CONFIG.BOOTH_API_KEY) {
    res.status(401).json({ error: 'Invalid or missing booth API key' });
    return;
  }

  // Validate boothId against whitelist (if configured)
  const boothId = req.body?.boothId || req.query.boothId as string;
  if (boothId && CONFIG.ALLOWED_BOOTHS) {
    const allowed = CONFIG.ALLOWED_BOOTHS.split(',').map(s => s.trim().toLowerCase());
    if (allowed.length > 0 && allowed[0] !== '' && !allowed.includes(boothId.toLowerCase())) {
      res.status(403).json({ error: `Booth "${boothId}" is not in the allowed list` });
      return;
    }
  }

  next();
}
