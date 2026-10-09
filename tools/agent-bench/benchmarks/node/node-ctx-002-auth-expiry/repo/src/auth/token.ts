// exp: segundos desde epoch. Los relojes (nowMs) estan en milisegundos.
export interface Token {
  sub: string;
  exp: number;
}

export function issueToken(sub: string, nowMs: number, ttlSec: number): Token {
  return { sub, exp: Math.floor(nowMs / 1000) + ttlSec };
}

export function isExpired(t: Token, nowMs: number): boolean {
  return t.exp <= nowMs;
}
