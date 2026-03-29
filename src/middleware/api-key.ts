/**
 * Simple API Key Authentication Middleware
 * Checks x-api-key header or apiKey query param
 */

import { Request, Response, NextFunction } from 'express';
import { CONFIG } from '../config';

export function requireApiKey(req: Request, res: Response, next: NextFunction): void {
  const key = (req.headers['x-api-key'] as string) || (req.query.apiKey as string);
  if (!key || key !== CONFIG.ADMIN_API_KEY) {
    res.status(401).json({ error: 'Unauthorized — invalid or missing API key' });
    return;
  }
  next();
}
