/** Reloj inyectable: el motor nunca usa Date/setTimeout directamente para backoff, pausas y presupuesto de tiempo. */
export interface Clock {
  now(): number;
  /** Espera `ms`. Resuelve true al cumplirse, false si `signal` aborta (nunca rechaza). */
  sleep(ms: number, signal?: AbortSignal): Promise<boolean>;
  /** Aleatoriedad para jitter, en [0,1). */
  random(): number;
}

export const realClock: Clock = {
  now: () => Date.now(),
  random: () => Math.random(),
  sleep(ms, signal) {
    return new Promise<boolean>((resolve) => {
      if (signal?.aborted) return resolve(false);
      const t = setTimeout(() => { signal?.removeEventListener("abort", onAbort); resolve(true); }, Math.max(0, ms));
      const onAbort = (): void => { clearTimeout(t); resolve(false); };
      signal?.addEventListener("abort", onAbort, { once: true });
    });
  },
};

export interface ManualClock extends Clock {
  /** esperas solicitadas, en orden */
  readonly sleeps: number[];
  advance(ms: number): void;
}

/** Reloj virtual para pruebas: sleep() avanza el tiempo virtual al instante (cede el turno al bucle de eventos). */
export function createManualClock(start = 1_700_000_000_000, rand: () => number = () => 0.5): ManualClock {
  let t = start;
  const sleeps: number[] = [];
  return {
    sleeps,
    now: () => t,
    random: rand,
    advance(ms) { t += ms; },
    async sleep(ms, signal) {
      if (signal?.aborted) return false;
      sleeps.push(ms);
      t += Math.max(0, ms);
      await new Promise<void>((r) => setImmediate(r));
      return !signal?.aborted;
    },
  };
}
