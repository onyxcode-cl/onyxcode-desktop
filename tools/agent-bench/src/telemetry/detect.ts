/** Detección de rate limit y de colgado, común a los runners reales. */

const RATE_LIMIT_RE =
  /(token rate limit|rate[ _-]?limit(?:ed)?|too many requests|\b429\b|quota exceeded|usage limit|requests? per minute|tokens? per minute|overloaded_error)/i;

export function isRateLimitText(text: string | null | undefined): boolean {
  return !!text && RATE_LIMIT_RE.test(text);
}

/** Vigilante de inactividad: `touch()` en cada evento; `expired()` tras inactivityMs sin actividad. */
export class InactivityWatch {
  private last: number;
  readonly inactivityMs: number;
  private readonly now: () => number;
  constructor(inactivityMs: number, now: () => number = Date.now) {
    this.inactivityMs = inactivityMs;
    this.now = now;
    this.last = now();
  }
  touch(): void {
    this.last = this.now();
  }
  idleMs(): number {
    return this.now() - this.last;
  }
  expired(): boolean {
    return this.idleMs() > this.inactivityMs;
  }
}
