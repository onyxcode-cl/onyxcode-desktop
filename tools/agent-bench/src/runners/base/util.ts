import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { isAlive, sleep } from "../../core/proc.ts";
import { METRIC_NAMES } from "./types.ts";
import type { Capabilities, MetricName } from "./types.ts";

/** Pids (distintos del actual) cuya línea de comando contiene `needle`. */
export function procsMatching(needle: string): number[] {
  const r = spawnSync("ps", ["-A", "-ww", "-o", "pid=,command="], { encoding: "utf8", timeout: 10_000, maxBuffer: 64 * 1024 * 1024 });
  const out: number[] = [];
  for (const line of (r.stdout ?? "").split("\n")) {
    const m = /^\s*(\d+)\s+(.*)$/.exec(line);
    if (!m) continue;
    const pid = Number(m[1]);
    if (pid !== process.pid && (m[2] ?? "").includes(needle) && isAlive(pid)) out.push(pid);
  }
  return out;
}

/** SIGKILL a todo proceso que contenga `needle`; devuelve {reaped, orphans(supervivientes)}. */
export async function killMatching(needle: string): Promise<{ reaped: number; orphans: number }> {
  const found = procsMatching(needle);
  for (const pid of found) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      /* ya muerto */
    }
  }
  const deadline = Date.now() + 2000;
  while (Date.now() < deadline && found.some(isAlive)) await sleep(25);
  return { reaped: found.length, orphans: found.filter(isAlive).length };
}

/** Huella de un árbol: ruta relativa -> tamaño:sha1 (dirs marcados). */
export function footprint(root: string): Record<string, string> {
  const res: Record<string, string> = {};
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir).sort()) {
      const p = join(dir, name);
      const st = statSync(p);
      const rel = relative(root, p);
      if (st.isDirectory()) {
        res[rel + "/"] = "dir";
        walk(p);
      } else res[rel] = `${st.size}:${createHash("sha1").update(readFileSync(p)).digest("hex")}`;
    }
  };
  if (existsSync(root)) walk(root);
  return res;
}

/** Archivos (bajo `root`) cuyo contenido contiene `needle`. */
export function grepTree(root: string, needle: string): string[] {
  const hits: string[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      const st = statSync(p);
      if (st.isDirectory()) walk(p);
      else if (st.size < 64 * 1024 * 1024 && readFileSync(p).includes(needle)) hits.push(p);
    }
  };
  if (existsSync(root)) {
    if (statSync(root).isDirectory()) walk(root);
    else if (readFileSync(root).includes(needle)) hits.push(root);
  }
  return hits;
}

export function fullCapabilities(): Capabilities {
  return Object.fromEntries(METRIC_NAMES.map((m) => [m, true])) as Capabilities;
}

/** Fuerza null en toda métrica no declarada y en las no observadas (nunca 0 por defecto). */
export function applyCapabilities(caps: Capabilities, measured: Partial<Record<MetricName, number | null>>): Record<MetricName, number | null> {
  const out = {} as Record<MetricName, number | null>;
  for (const m of METRIC_NAMES) out[m] = caps[m] ? (measured[m] ?? null) : null;
  return out;
}
