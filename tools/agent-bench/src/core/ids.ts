import { createHash, randomUUID } from "node:crypto";

/** Id de run aleatorio (UUID v4). */
export function newRunId(): string {
  return randomUUID();
}

/** Primeros 8 caracteres hex del id (para rutas ~/ab/r/<runId8>). */
export function runId8(runId: string): string {
  const h = runId.replace(/-/g, "");
  if (!/^[0-9a-f]{8,}$/i.test(h)) throw new Error(`runId inválido: ${runId}`);
  return h.slice(0, 8).toLowerCase();
}

/** JSON canónico: claves ordenadas, sin espacios. Útil para hashes estables. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).filter((k) => obj[k] !== undefined).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(",")}}`;
}

/** sha256 hex de un string o del JSON canónico de un valor. */
export function contentHash(value: unknown): string {
  const s = typeof value === "string" ? value : canonicalJson(value);
  return createHash("sha256").update(s).digest("hex");
}

/** Id determinista (16 hex) a partir de partes; mismo input => mismo id. */
export function deterministicId(...parts: unknown[]): string {
  return contentHash(parts).slice(0, 16);
}

/** PRNG determinista mulberry32; devuelve flotantes en [0,1). */
export function seededRng(seed: number | string): () => number {
  let a = typeof seed === "number" ? seed >>> 0 : parseInt(contentHash(seed).slice(0, 8), 16);
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fisher-Yates determinista; no muta la entrada. */
export function seededShuffle<T>(items: readonly T[], seed: number | string): T[] {
  const rng = seededRng(seed);
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
}
