import { NextFunction, Request, Response } from 'express';

/**
 * Path-scoped CORS middleware for /demo/*. Mounted in main.ts via
 * `app.use('/demo', createDemoCorsMiddleware(allowedOrigins))`. The
 * existing app-wide enableCors() handles admin origins for everything
 * else; this middleware is the only CORS layer the /demo routes hit.
 */
const LOCALHOST_RE = /^https?:\/\/localhost(:\d+)?$/;

export function createDemoCorsMiddleware(allowedOrigins: string[]) {
  const explicit = new Set(allowedOrigins);
  return function demoCorsMiddleware(
    req: Request,
    res: Response,
    next: NextFunction,
  ): void {
    const origin = req.headers.origin;
    const allowed =
      typeof origin === 'string' &&
      (explicit.has(origin) || LOCALHOST_RE.test(origin));

    if (allowed && typeof origin === 'string') {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'content-type');
      res.setHeader('Vary', 'Origin');
    }

    if (req.method === 'OPTIONS') {
      res.sendStatus(allowed ? 204 : 403);
      return;
    }
    next();
  };
}
