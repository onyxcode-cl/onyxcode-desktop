import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { readUsage } from "./events.ts";
import type { RolloutTokens } from "./types.ts";

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/^rollout-.*\.jsonl$/.test(e)) out.push(p);
  }
  return out;
}

export function findRollouts(codexHome: string): string[] {
  return walk(join(codexHome, "sessions")).sort();
}

/**
 * Lee los rollouts del CODEX_HOME del run y deduplica eventos token_count:
 * Codex repite el mismo total_token_usage (p. ej. al emitir rate limits), así
 * que solo cuentan los totales distintos. Pico de contexto = max last_token_usage.input_tokens (NV).
 */
export function parseRollouts(files: string[]): RolloutTokens | null {
  if (!files.length) return null;
  let raw = 0;
  let distinct = 0;
  let peak: number | null = null;
  let last: ReturnType<typeof readUsage> = null;
  for (const f of files) {
    const seen = new Set<string>();
    for (const line of readFileSync(f, "utf8").split("\n")) {
      if (!line.includes("token_count")) continue;
      let o: any;
      try {
        o = JSON.parse(line);
      } catch {
        continue;
      }
      const pl = o?.payload;
      if (o?.type !== "event_msg" || pl?.type !== "token_count") continue;
      const total = pl.info?.total_token_usage;
      if (!total) continue; // token_count solo con rate_limits
      raw++;
      const key = JSON.stringify(total);
      if (seen.has(key)) continue;
      seen.add(key);
      distinct++;
      last = readUsage(total);
      const lastCall = readUsage(pl.info?.last_token_usage);
      if (lastCall?.input_tokens != null) peak = Math.max(peak ?? 0, lastCall.input_tokens);
    }
  }
  return { distinctCalls: distinct, rawEvents: raw, duplicatesDropped: raw - distinct, peakContext: peak, lastTotal: last, files: files.length };
}
