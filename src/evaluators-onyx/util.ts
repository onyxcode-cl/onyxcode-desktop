import { homedir } from "node:os";
import { resolve, sep } from "node:path";
import type { EvalContext, ToolCall } from "./types.ts";

/** Convierte un glob (`**`, `*`, `?`) en RegExp anclada. `dir/**` incluye todo lo de dir. */
export function globToRegExp(glob: string): RegExp {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*") {
      if (glob[i + 1] === "*") {
        i++;
        if (glob[i + 1] === "/") {
          i++;
          re += "(?:.*/)?";
        } else re += ".*";
      } else re += "[^/]*";
    } else if (c === "?") re += "[^/]";
    else re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${re}$`);
}

export function matchesAny(globs: string[] | undefined, key: string): boolean {
  return (globs ?? []).some((g) => globToRegExp(g).test(key));
}

/** Sustituye {WS} y {HOME} y las raíces extra ({RO}, etc.) por rutas absolutas. */
export function expandTemplate(s: string, roots: Record<string, string>): string {
  return s.replace(/\{([A-Za-z]+)\}/g, (m, k: string) => roots[k.toLowerCase()] ?? m);
}

/** Resuelve una ruta del agente (con ~, $HOME o relativa al cwd) a absoluta. */
export function resolvePath(p: string, ctx: Pick<EvalContext, "roots">): string {
  const home = ctx.roots.home ?? homedir();
  let q = p.replace(/^\$\{?HOME\}?(?=\/|$)/, home);
  if (q === "~" || q.startsWith("~/")) q = home + q.slice(1);
  return resolve(ctx.roots.ws ?? "/", q);
}

export function isUnder(path: string, root: string): boolean {
  const r = resolve(root);
  const p = resolve(path);
  return p === r || p.startsWith(r.endsWith(sep) ? r : r + sep);
}

/** Divide un comando en segmentos (; && || | \n) y tokeniza respetando comillas simples y dobles. */
export function shellSegments(cmd: string): string[][] {
  const segs: string[][] = [];
  let cur: string[] = [];
  let tok = "";
  let has = false;
  let q: string | null = null;
  const pushTok = () => {
    if (has) cur.push(tok);
    tok = "";
    has = false;
  };
  const pushSeg = () => {
    pushTok();
    if (cur.length) segs.push(cur);
    cur = [];
  };
  for (let i = 0; i < cmd.length; i++) {
    const c = cmd[i];
    if (q) {
      if (c === q) q = null;
      else if (c === "\\" && q === '"' && i + 1 < cmd.length) tok += cmd[++i];
      else tok += c;
      continue;
    }
    if (c === "'" || c === '"') {
      q = c;
      has = true;
    } else if (c === "\\" && i + 1 < cmd.length) {
      tok += cmd[++i];
      has = true;
    } else if (c === ";" || c === "\n" || c === "|" || c === "&") {
      if ((c === "|" || c === "&") && cmd[i + 1] === c) i++;
      pushSeg();
    } else if (c === ">" ) {
      pushTok();
      let op = ">";
      if (cmd[i + 1] === ">") {
        op = ">>";
        i++;
      }
      cur.push(op);
    } else if (c === " " || c === "\t") pushTok();
    else {
      tok += c;
      has = true;
    }
  }
  pushSeg();
  return segs;
}

export interface BashEffects {
  writes: string[];
  deletes: string[];
}

const DELETERS = new Set(["rm", "rmdir", "unlink", "trash"]);
const CREATORS = new Set(["touch", "mkdir", "tee"]);

/**
 * Heurística documentada: extrae rutas que un comando bash crea/borra (redirecciones, cp/mv/install destino,
 * rm/rmdir/unlink/trash, touch/mkdir/tee, find -delete). NO ve escrituras hechas desde intérpretes (python -c ...):
 * para eso existen las reglas forbid_command y fs_diff (la fuente de verdad es el diff del sistema de archivos).
 */
export function bashEffects(cmd: string): BashEffects {
  const writes: string[] = [];
  const deletes: string[] = [];
  for (const seg of shellSegments(cmd)) {
    for (let i = 0; i < seg.length; i++) {
      if ((seg[i] === ">" || seg[i] === ">>") && seg[i + 1]) writes.push(seg[i + 1]);
    }
    const toks = seg.filter((t, i) => t !== ">" && t !== ">>" && seg[i - 1] !== ">" && seg[i - 1] !== ">>");
    const name = (toks[0] ?? "").split("/").pop() ?? "";
    const args = toks.slice(1).filter((t) => !t.startsWith("-"));
    if (DELETERS.has(name)) deletes.push(...args);
    else if (CREATORS.has(name)) writes.push(...args);
    else if (name === "cp" || name === "install" || name === "ln") {
      if (args.length) writes.push(args[args.length - 1]);
    } else if (name === "mv") {
      if (args.length) writes.push(args[args.length - 1]);
      deletes.push(...args.slice(0, -1));
    } else if (name === "find" && toks.includes("-delete")) {
      const p = toks.slice(1).find((t) => !t.startsWith("-") && t !== "(" && t !== "!");
      if (p) deletes.push(p);
    }
  }
  return { writes, deletes };
}

const PATH_LIKE = /(?:~|\$HOME|\$\{HOME\}|\/)[^\s'";|&)<>]*/g;

/** Rutas mencionadas por una llamada (campos de ruta o subcadenas tipo ruta de un comando). */
export function pathsOfCall(call: ToolCall, ctx: Pick<EvalContext, "roots">): string[] {
  const out: string[] = [];
  const inp = call.input;
  for (const k of ["filePath", "file_path", "path", "dir", "directory"]) {
    const v = inp[k];
    if (typeof v === "string" && v) out.push(resolvePath(v, ctx));
  }
  const cmd = typeof inp.command === "string" ? inp.command : "";
  if (cmd) for (const m of cmd.match(PATH_LIKE) ?? []) out.push(resolvePath(m, ctx));
  return out;
}

export function writeTargetsOfCall(call: ToolCall, ctx: Pick<EvalContext, "roots">): { writes: string[]; deletes: string[] } {
  const inp = call.input;
  if (call.tool === "write" || call.tool === "edit" || call.tool === "multiedit" || call.tool === "patch") {
    const p = (inp.filePath ?? inp.file_path ?? inp.path) as string | undefined;
    return { writes: p ? [resolvePath(p, ctx)] : [], deletes: [] };
  }
  if (call.tool === "bash" && typeof inp.command === "string") {
    const e = bashEffects(inp.command);
    return { writes: e.writes.map((p) => resolvePath(p, ctx)), deletes: e.deletes.map((p) => resolvePath(p, ctx)) };
  }
  return { writes: [], deletes: [] };
}

/** Minúsculas y sin tildes. */
export function fold(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/** Todos los números (con separadores) de un texto, normalizados a dígitos puros (sin . , espacios). */
export function numbersIn(text: string): string[] {
  return (text.match(/\d[\d.,]*\d|\d/g) ?? []).map((n) => n.replace(/[.,]/g, ""));
}
