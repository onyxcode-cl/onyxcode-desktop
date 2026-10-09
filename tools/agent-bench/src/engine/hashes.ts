import { createHash } from "node:crypto";
import { existsSync, lstatSync, readdirSync, readFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { canonicalJson } from "../core/ids.ts";
import type { Configuration, Scenario } from "../core/schemas.ts";

/** Hash de contenido de un archivo o directorio (rutas y bytes; no sigue symlinks; ignora .git y node_modules). */
export function hashPath(p: string): string {
  const h = createHash("sha256");
  const walk = (cur: string): void => {
    const st = lstatSync(cur);
    const rel = relative(p, cur).split(sep).join("/");
    if (st.isSymbolicLink()) { h.update(`L:${rel}\0`); return; }
    if (st.isDirectory()) {
      for (const e of readdirSync(cur).sort()) {
        if (e === ".git" || e === "node_modules") continue;
        h.update(`D:${rel}/${e}\0`);
        walk(join(cur, e));
      }
    } else if (st.isFile()) {
      h.update(`F:${rel}\0`);
      h.update(readFileSync(cur));
      h.update("\0");
    }
  };
  if (!existsSync(p)) return "missing";
  walk(p);
  return h.digest("hex");
}

function resolveRef(benchRoot: string, path: string): string {
  if (isAbsolute(path)) return path;
  for (const base of [benchRoot, join(benchRoot, "configurations")]) if (existsSync(resolve(base, path))) return resolve(base, path);
  return resolve(benchRoot, path);
}

/**
 * Hash de la versión de una Configuration: su JSON canónico MÁS el contenido de los archivos que referencia
 * (prompts, skills, subagentes): editar un prompt con el mismo id cambia el hash (A6).
 */
export function hashConfiguration(cfg: Configuration, benchRoot: string): string {
  const files: Record<string, string> = {};
  for (const f of [...cfg.prompts, ...cfg.skills, ...cfg.subagents]) {
    if (f.path !== null) files[`${f.name}@${f.version}`] = hashPath(resolveRef(benchRoot, f.path));
  }
  return createHash("sha256").update(canonicalJson({ cfg, files })).digest("hex");
}

/** Hash de la versión de un caso: su JSON canónico (tarea, evaluadores...) MÁS fixture y tests ocultos. */
export function hashScenario(sc: Scenario, benchRoot: string, fixtureTree: string | null = null): string {
  const fixture = fixtureTree ?? hashPath(resolve(benchRoot, sc.fixture.path));
  const hidden = sc.hiddenTests ? hashPath(resolve(benchRoot, sc.hiddenTests)) : null;
  return createHash("sha256").update(canonicalJson({ sc, fixture, hidden })).digest("hex");
}
