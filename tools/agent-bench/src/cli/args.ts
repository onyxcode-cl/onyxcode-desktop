// Parser de argumentos propio (sin dependencias). Mensajes en español.

export type OptKind = "boolean" | "string" | "number" | "int";

export interface OptSpec {
  kind: OptKind;
  /** Mínimo (inclusive) para number/int. */
  min?: number;
  /** Máximo (inclusive) para number/int. */
  max?: number;
  alias?: string;
}

export type OptTable = Record<string, OptSpec>;

export class UsageError extends Error {
  readonly code = "USO";
  constructor(message: string) {
    super(message);
    this.name = "UsageError";
  }
}

export interface Parsed {
  positionals: string[];
  options: Record<string, string | number | boolean>;
}

function toNumber(name: string, raw: string, spec: OptSpec): number {
  const n = Number(raw);
  if (raw.trim() === "" || !Number.isFinite(n)) throw new UsageError(`--${name} espera un número y recibió "${raw}"`);
  if (spec.kind === "int" && !Number.isInteger(n)) throw new UsageError(`--${name} espera un entero y recibió "${raw}"`);
  if (spec.min !== undefined && n < spec.min) throw new UsageError(`--${name} debe ser >= ${spec.min} (recibió ${raw})`);
  if (spec.max !== undefined && n > spec.max) throw new UsageError(`--${name} debe ser <= ${spec.max} (recibió ${raw})`);
  return n;
}

/** Interpreta argv (sin node ni script). `--k v`, `--k=v`, `-k v` por alias, `--` termina las opciones. */
export function parseArgs(argv: readonly string[], table: OptTable): Parsed {
  const aliases = new Map<string, string>();
  for (const [name, spec] of Object.entries(table)) if (spec.alias) aliases.set(spec.alias, name);
  const out: Parsed = { positionals: [], options: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--") {
      out.positionals.push(...argv.slice(i + 1));
      break;
    }
    let name: string;
    let inline: string | undefined;
    if (a.startsWith("--")) {
      const eq = a.indexOf("=");
      name = eq >= 0 ? a.slice(2, eq) : a.slice(2);
      inline = eq >= 0 ? a.slice(eq + 1) : undefined;
    } else if (a.length === 2 && a.startsWith("-") && /[a-zA-Z]/.test(a[1]!)) {
      const mapped = aliases.get(a[1]!);
      if (!mapped) throw new UsageError(`opción desconocida: ${a}`);
      name = mapped;
    } else {
      out.positionals.push(a);
      continue;
    }
    const spec = table[name];
    if (!spec) throw new UsageError(`opción desconocida: --${name}`);
    if (name in out.options) throw new UsageError(`--${name} repetida`);
    if (spec.kind === "boolean") {
      if (inline !== undefined) {
        if (inline !== "true" && inline !== "false") throw new UsageError(`--${name} no admite valor (recibió "${inline}")`);
        out.options[name] = inline === "true";
      } else out.options[name] = true;
      continue;
    }
    let raw = inline;
    if (raw === undefined) {
      const next = argv[i + 1];
      if (next === undefined || (next.startsWith("--") && next.length > 2)) throw new UsageError(`--${name} requiere un valor`);
      raw = next;
      i++;
    }
    out.options[name] = spec.kind === "string" ? raw : toNumber(name, raw, spec);
  }
  return out;
}

export const COMMON_OPTS: OptTable = {
  help: { kind: "boolean", alias: "h" },
  json: { kind: "boolean" },
  "dry-run": { kind: "boolean" },
  yes: { kind: "boolean", alias: "y" },
  out: { kind: "string", alias: "o" },
  seed: { kind: "int" },
  timeout: { kind: "number", min: 1 },
  "max-cost": { kind: "number", min: 0 },
  "max-concurrency": { kind: "int", min: 1 },
  "max-runs": { kind: "int", min: 1 },
  "max-wall": { kind: "number", min: 1 },
};

export function pick(table: OptTable, names: readonly string[], extra: OptTable = {}): OptTable {
  const t: OptTable = {};
  for (const n of names) {
    const s = table[n];
    if (!s) throw new Error(`opción común inexistente: ${n}`);
    t[n] = s;
  }
  return { ...t, ...extra };
}
