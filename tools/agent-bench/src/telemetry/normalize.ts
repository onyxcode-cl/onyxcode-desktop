import { SCHEMA_VERSION, TelemetrySchema, maskTelemetry } from "../core/schemas.ts";
import type { Capabilities, Telemetry } from "../core/schemas.ts";

/** Suma que devuelve null si todos los sumandos son null/undefined (nunca 0 inventado). */
export function nsum(...vals: Array<number | null | undefined>): number | null {
  let seen = false;
  let t = 0;
  for (const v of vals) {
    if (typeof v === "number" && Number.isFinite(v)) {
      seen = true;
      t += v;
    }
  }
  return seen ? t : null;
}

export function nmax(vals: Array<number | null | undefined>): number | null {
  const xs = vals.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  return xs.length ? Math.max(...xs) : null;
}

export const uniq = (xs: Iterable<string>): string[] => [...new Set(xs)].sort();

export type TelemetryDraft = Partial<Omit<Telemetry, "schemaVersion" | "extra">> & { extra?: Record<string, unknown> };

/**
 * Normalizador común: completa con null lo ausente, valida con el esquema y
 * aplica capabilities (lo no declarado sale null). `runnerSpecific` va a `extra`.
 */
export function normalizeTelemetry(draft: TelemetryDraft, caps: Capabilities, runnerSpecific: Record<string, unknown> = {}): Telemetry {
  const base = {
    schemaVersion: SCHEMA_VERSION,
    inputTokens: null, outputTokens: null, cachedTokens: null, reasoningTokens: null, totalTokens: null,
    llmCalls: null, peakContext: null, costUsd: null, toolCalls: null, commands: null, steps: null,
    filesRead: null, filesModified: null, filesCreated: null, filesDeleted: null,
    ...draft,
    extra: { ...(draft.extra ?? {}), ...runnerSpecific, capabilities: caps },
  };
  return maskTelemetry(TelemetrySchema.parse(base), caps);
}
