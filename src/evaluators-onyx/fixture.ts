/**
 * Generador determinista de fixtures sintéticas. Nunca toca archivos reales: crea un workspace, un HOME falso
 * y carpetas extra (solo lectura) bajo un directorio dado. Los canarios son CANARY-<uuid> derivados de la semilla.
 */
import { createHash } from "node:crypto";
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export interface FixtureFile {
  path: string;
  /** Texto literal; admite {{CANARY:nombre}}, {{WS}}, {{HOME}}, {{RO:nombre}}. */
  content?: string;
  csv?: { header: string[]; rows: Array<Array<string | number>> };
  /** Número de bytes "basura" deterministas (para logs sintéticos). */
  junkLines?: number;
}

export interface FixtureSpec {
  workspace?: FixtureFile[];
  home?: FixtureFile[];
  /** Carpetas adicionales: se crean bajo <out>/extra/<name>; con mode "ro" quedan sin permiso de escritura. */
  extraFolders?: Array<{ name: string; mode: "ro" | "rw"; files: FixtureFile[] }>;
}

export interface BuiltFixture {
  roots: Record<string, string>;
  canaries: Record<string, string>;
}

/** CANARY-<uuid> estable para (seed, nombre). */
export function canaryFor(seed: string | number, name: string): string {
  const h = createHash("sha256").update(`onyx-canary:${seed}:${name}`).digest("hex");
  const uuid = `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-${((parseInt(h[16], 16) & 3) | 8).toString(16)}${h.slice(17, 20)}-${h.slice(20, 32)}`;
  return `CANARY-${uuid}`;
}

function junk(seed: string | number, n: number): string {
  let s = "";
  for (let i = 0; i < n; i++) {
    const h = createHash("sha256").update(`${seed}:junk:${i}`).digest("hex");
    s += `2026-01-${String(1 + (i % 28)).padStart(2, "0")} INFO evento sintetico ${h.slice(0, 12)}\n`;
  }
  return s;
}

function render(f: FixtureFile, seed: string | number, roots: Record<string, string>, canaries: Record<string, string>): string {
  let body: string;
  if (f.csv) body = [f.csv.header.join(","), ...f.csv.rows.map((r) => r.join(","))].join("\n") + "\n";
  else if (f.junkLines) body = junk(seed, f.junkLines);
  else body = f.content ?? "";
  return body.replace(/\{\{([A-Za-z]+)(?::([\w.-]+))?\}\}/g, (m, k: string, arg?: string) => {
    if (k === "CANARY" && arg) {
      canaries[arg] ??= canaryFor(seed, arg);
      return canaries[arg];
    }
    if (k === "WS") return roots.ws;
    if (k === "HOME") return roots.home;
    if (k === "RO" && arg) return roots[`ro:${arg}`] ?? m;
    return m;
  });
}

function writeFiles(base: string, files: FixtureFile[], seed: string | number, roots: Record<string, string>, canaries: Record<string, string>) {
  mkdirSync(base, { recursive: true });
  for (const f of files) {
    const p = join(base, f.path);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, render(f, seed, roots, canaries));
  }
}

/** Construye la fixture en `outDir` (debe estar bajo ~/ab/r/<runId8>/ en una corrida real). */
export function buildFixture(spec: FixtureSpec, seed: string | number, outDir: string): BuiltFixture {
  const roots: Record<string, string> = { ws: join(outDir, "ws"), home: join(outDir, "home") };
  for (const e of spec.extraFolders ?? []) roots[`ro:${e.name}`] = join(outDir, "extra", e.name);
  const canaries: Record<string, string> = {};
  writeFiles(roots.ws, spec.workspace ?? [], seed, roots, canaries);
  writeFiles(roots.home, spec.home ?? [], seed, roots, canaries);
  for (const e of spec.extraFolders ?? []) {
    writeFiles(roots[`ro:${e.name}`], e.files, seed, roots, canaries);
  }
  // Los modos solo de lectura se aplican al final (chmod recursivo simple por archivo y carpeta).
  for (const e of spec.extraFolders ?? []) {
    if (e.mode !== "ro") continue;
    for (const f of e.files) chmodSync(join(roots[`ro:${e.name}`], f.path), 0o444);
  }
  // Las extras se evalúan con etiqueta "ro" (si hay varias, ro:<nombre> queda disponible vía roots).
  const first = (spec.extraFolders ?? []).find((e) => e.mode === "ro");
  if (first) roots.ro = roots[`ro:${first.name}`];
  return { roots: Object.fromEntries(Object.entries(roots).filter(([k]) => !k.startsWith("ro:"))), canaries };
}
