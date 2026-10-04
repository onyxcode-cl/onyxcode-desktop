import { execFileSync } from "node:child_process";
import { loadavg, cpus } from "node:os";
import type { GateDecision, GateMetrics, GateThresholds } from "./types.ts";

export const DEFAULT_THRESHOLDS: GateThresholds = { maxLoadPerCpu: 0.6, minFreeMemMB: 1024 };

function sh(cmd: string, args: string[]): string | null {
  try {
    return execFileSync(cmd, args, { encoding: "utf8", timeout: 5000, stdio: ["ignore", "pipe", "ignore"] });
  } catch { return null; }
}

/** Memoria disponible (libre + inactiva + especulativa + purgable) en MB, o null. */
export function parseVmStat(out: string): number | null {
  const size = Number(/page size of (\d+) bytes/.exec(out)?.[1]);
  if (!size) return null;
  let pages = 0;
  for (const key of ["Pages free", "Pages inactive", "Pages speculative", "Pages purgeable"]) {
    const m = new RegExp(`${key}:\\s+(\\d+)`).exec(out);
    if (m) pages += Number(m[1]);
  }
  return Math.round((pages * size) / 1048576);
}

export function parseTherm(out: string | null): GateMetrics["thermal"] {
  if (out === null) return "unknown";
  const levels = [...out.matchAll(/(?:warning level|CPU_Speed_Limit)\D*=?\s*(\d+)/gi)];
  if (/No thermal warning level has been recorded/i.test(out) && !levels.some((m) => Number(m[1]) > 0 && /Speed_Limit/i.test(m[0]) && Number(m[1]) < 100)) {
    return "nominal";
  }
  for (const m of levels) {
    if (/Speed_Limit/i.test(m[0]) && Number(m[1]) < 100) return "warning";
    if (/warning level/i.test(m[0]) && Number(m[1]) > 0) return "warning";
  }
  return "nominal";
}

export function evaluateGate(m: GateMetrics, t: GateThresholds = DEFAULT_THRESHOLDS): GateDecision {
  const reasons: string[] = [];
  if (m.loadPerCpu > t.maxLoadPerCpu) reasons.push(`carga ${m.loadPerCpu.toFixed(2)}/cpu > ${t.maxLoadPerCpu}`);
  if (m.freeMemMB !== null && m.freeMemMB < t.minFreeMemMB) reasons.push(`memoria libre ${m.freeMemMB} MB < ${t.minFreeMemMB} MB`);
  if (m.thermal === "warning") reasons.push("aviso térmico del sistema");
  return reasons.length
    ? { schemaVersion: "1", status: "pausa", reason: reasons.join("; "), metrics: m }
    : { schemaVersion: "1", status: "ok", metrics: m };
}

export function sampleMetrics(): GateMetrics {
  const ncpu = Math.max(1, cpus().length);
  const vm = sh("/usr/bin/vm_stat", []);
  const therm = sh("/usr/bin/pmset", ["-g", "therm"]);
  return {
    loadPerCpu: (loadavg()[0] ?? 0) / ncpu,
    ncpu,
    freeMemMB: vm ? parseVmStat(vm) : null,
    thermal: parseTherm(therm),
  };
}

export function loadGate(t: GateThresholds = DEFAULT_THRESHOLDS): GateDecision {
  return evaluateGate(sampleMetrics(), t);
}
