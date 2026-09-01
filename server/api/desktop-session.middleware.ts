import { timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

const DESKTOP_SESSION_HEADER = 'x-desktop-session-token';

export function matchesDesktopSessionToken(received: string | undefined, expected: string): boolean {
  if (!received || received.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(received), Buffer.from(expected));
}

/** Guards the loopback-only desktop sidecar from other local processes. */
export function createDesktopSessionGuard(token: string) {
  return (request: Request, response: Response, next: NextFunction): void => {
    if (request.path === '/health') {
      next();
      return;
    }
    const header = request.headers[DESKTOP_SESSION_HEADER];
    const received = Array.isArray(header) ? undefined : header;
    if (!matchesDesktopSessionToken(received, token)) {
      response.status(401).json({ errorCode: 'desktop_session_required' });
      return;
    }
    next();
  };
}

export { DESKTOP_SESSION_HEADER };
