import { execFileSync } from "node:child_process";
import { existsSync, statfsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { sandboxAvailable } from "./seatbelt.ts";
import type { DoctorCheck, DoctorReport } from "./types.ts";

export interface DoctorOptions {
  opencodeBin?: string;
  managedConfigDir?: string;
  diskPath?: string;
  minDiskGB?: number;
  minNodeMajor?: number;
}

function version(cmd: string, args: string[]): string | null {
  try {
    return execFileSync(cmd, args, { encoding: "utf8", timeout: 10000, stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch { return null; }
}

/** Solo comprueba el entorno; nunca ejecuta modelos. */
export function doctor(o: DoctorOptions = {}): DoctorReport {
  const checks: DoctorCheck[] = [];
  const add = (name: string, status: DoctorCheck["status"], detail: string) => checks.push({ name, status, detail });

  const major = Number(process.versions.node.split(".")[0]);
  add("node", major >= (o.minNodeMajor ?? 22) ? "ok" : "fail", process.versions.node);

  const git = version("git", ["--version"]);
  add("git", git ? "ok" : "fail", git ?? "no encontrado");

  const ocBin = o.opencodeBin ?? join(homedir(), ".opencode", "bin", "opencode");
  if (existsSync(ocBin)) {
    const v = version(ocBin, ["--version"]);
    add("opencode", v ? "ok" : "warn", v ?? `${ocBin} no responde a --version`);
  } else add("opencode", "fail", `no existe ${ocBin}`);

  try {
    const s = statfsSync(o.diskPath ?? homedir());
    const freeGB = Math.round((Number(s.bavail) * Number(s.bsize)) / 1e9);
    add("disco", freeGB >= (o.minDiskGB ?? 5) ? "ok" : "fail", `${freeGB} GB libres`);
  } catch (e) { add("disco", "warn", `no medible: ${String(e)}`); }

  add("sandbox-exec", sandboxAvailable() ? "ok" : "fail", sandboxAvailable() ? "disponible" : "ausente");

  const managed = o.managedConfigDir ?? "/Library/Application Support/opencode";
  add("config-gestionada", existsSync(managed) ? "fail" : "ok", existsSync(managed) ? `existe ${managed}` : "ausente");

  return { schemaVersion: "1", ok: checks.every((c) => c.status !== "fail"), checks };
}
