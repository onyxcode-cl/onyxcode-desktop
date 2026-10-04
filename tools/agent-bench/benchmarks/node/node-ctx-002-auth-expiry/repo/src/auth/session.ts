import { issueToken, isExpired, type Token } from './token.ts';

export const SESSION_TTL_SEC = 3600;

export interface Session {
  token: Token;
}

export function startSession(sub: string, nowMs: number): Session {
  return { token: issueToken(sub, nowMs, SESSION_TTL_SEC) };
}

export function refresh(s: Session, nowMs: number): Session {
  if (isExpired(s.token, nowMs)) throw new Error('session expired');
  return { token: issueToken(s.token.sub, Date.now(), SESSION_TTL_SEC) };
}
