import { closeSync, constants, fsyncSync, linkSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeSync, appendFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { randomBytes } from "node:crypto";

export class ImmutableRecordError extends Error {
  readonly path: string;
  constructor(path: string, detail?: string) {
    super(`registro inmutable: ya existe ${path}${detail ? ` (${detail})` : ""}`);
    this.name = "ImmutableRecordError";
    this.path = path;
  }
}

function tmpName(dir: string): string {
  return join(dir, `.tmp-${process.pid}-${randomBytes(6).toString("hex")}`);
}

function writeTmp(dir: string, data: string): string {
  mkdirSync(dir, { recursive: true });
  const tmp = tmpName(dir);
  const fd = openSync(tmp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
  try {
    writeSync(fd, data);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  return tmp;
}

/**
 * Escritura atómica SIN sobrescritura: escribe a un temporal en el mismo directorio y lo
 * publica con link() (falla con EEXIST si el destino existe). Nunca deja un archivo a medias.
 */
export function writeImmutable(path: string, data: string): void {
  const tmp = writeTmp(dirname(path), data);
  try {
    linkSync(tmp, path);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "EEXIST") throw new ImmutableRecordError(path);
    throw e;
  } finally {
    try { unlinkSync(tmp); } catch { /* ya no está */ }
  }
}

/** Escritura atómica con reemplazo (tmp+rename). Solo para artefactos derivados (índice), nunca registros. */
export function writeAtomicReplace(path: string, data: string): void {
  const tmp = writeTmp(dirname(path), data);
  try {
    renameSync(tmp, path);
  } catch (e) {
    try { unlinkSync(tmp); } catch { /* nada */ }
    throw e;
  }
}

/** Una línea JSON canónica terminada en \n. */
export function jsonLine(value: unknown): string {
  return JSON.stringify(value) + "\n";
}

/** Añade una línea a un diario append-only (nunca se reescribe lo anterior). */
export function appendLine(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, jsonLine(value), { mode: 0o600 });
}

/** Lee un JSONL; devuelve registros válidos y números de línea con error. */
export function readJsonl(path: string): { records: unknown[]; badLines: number[] } {
  if (!existsSync(path)) return { records: [], badLines: [] };
  const records: unknown[] = [];
  const badLines: number[] = [];
  const lines = readFileSync(path, "utf8").split("\n");
  lines.forEach((l, i) => {
    if (!l.trim()) return;
    try { records.push(JSON.parse(l)); } catch { badLines.push(i + 1); }
  });
  return { records, badLines };
}
