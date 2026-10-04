import { spawn } from "node:child_process";
import { lstatSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** Repositorio con gitdir separado (fuera del área escribible por el agente). */
export interface GitTree {
  gitDir: string;
  workTree: string;
  /** Índice alternativo (GIT_INDEX_FILE): evita tocar el índice del run al operar sobre copias. */
  indexFile?: string;
}

/** Entorno limpio: sin config global/sistema, sin variables GIT_* heredadas, sin HOME real. */
function gitEnv(tree?: GitTree): Record<string, string> {
  return {
    PATH: process.env.PATH ?? "/usr/bin:/bin",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_ATTR_NOSYSTEM: "1",
    GIT_TERMINAL_PROMPT: "0",
    GIT_OPTIONAL_LOCKS: "0",
    GIT_PAGER: "cat",
    LC_ALL: "C",
    ...(tree ? { GIT_DIR: tree.gitDir, GIT_WORK_TREE: tree.workTree } : {}),
    ...(tree?.indexFile ? { GIT_INDEX_FILE: tree.indexFile } : {}),
  };
}

/**
 * Opciones `-c` que neutralizan los vectores de ejecución por configuración. Tienen precedencia sobre
 * la config del repositorio (que en el modo "gitdir en el árbol" controla el agente).
 */
export const GIT_SAFE_CONFIG: readonly string[] = [
  "-c", "core.fsmonitor=false",
  "-c", "core.hooksPath=/dev/null",
  "-c", "protocol.allow=never",
  "-c", "core.untrackedCache=false",
  "-c", "core.pager=cat",
  "-c", "core.sshCommand=/usr/bin/false",
  "-c", "core.askPass=/usr/bin/false",
  "-c", "credential.helper=",
  "-c", "diff.external=",
  "-c", "commit.gpgsign=false",
  "-c", "gc.auto=0",
  "-c", "maintenance.auto=false",
];

const MINIMAL_CONFIG = "[core]\n\trepositoryformatversion = 0\n\tfilemode = true\n\tbare = false\n\tlogallrefupdates = true\n";

/**
 * Modo "gitdir en el árbol" (legado/pruebas): el agente puede haber reescrito `.git/config` (filter.*,
 * fsmonitor, ...) o dejado hooks. Antes de que el banco ejecute git se rehace la config mínima y se
 * borran hooks y atributos del repo. Un `.git` que no sea directorio real (symlink/archivo) se rechaza.
 */
export function sanitizeInTreeGit(dir: string): void {
  const g = join(dir, ".git");
  let st;
  try { st = lstatSync(g); } catch { return; } // aún no existe (git init)
  if (!st.isDirectory()) throw new Error(`.git no es un directorio real (¿symlink o gitfile del agente?): ${g}`);
  writeFileSync(join(g, "config"), MINIMAL_CONFIG);
  rmSync(join(g, "hooks"), { recursive: true, force: true });
  rmSync(join(g, "info", "attributes"), { force: true });
  rmSync(join(g, "config.worktree"), { force: true });
  rmSync(join(g, "commondir"), { force: true });
}

/**
 * Ejecuta git con entorno limpio y config de seguridad. Rechaza si sale != 0.
 * Con `tree`, usa `--git-dir/--work-tree` explícitos (el `.git` del workspace se ignora por completo).
 */
export function git(cwd: string, args: string[], timeoutMs = 60_000, tree?: GitTree): Promise<string> {
  if (!tree) sanitizeInTreeGit(cwd);
  return new Promise((resolve, reject) => {
    const pre = tree ? ["--git-dir", tree.gitDir, "--work-tree", tree.workTree] : [];
    const child = spawn("git", [...pre, ...GIT_SAFE_CONFIG, ...args], {
      cwd, env: gitEnv(tree), stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    let err = "";
    child.stdout.on("data", (d: Buffer) => { out += d.toString("utf8"); });
    child.stderr.on("data", (d: Buffer) => { err += d.toString("utf8"); });
    const t = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.on("error", (e) => { clearTimeout(t); reject(e); });
    child.on("close", (code) => {
      clearTimeout(t);
      if (code === 0) resolve(out);
      else reject(new Error(`git ${args.join(" ")} falló (${code}): ${err.trim()}`));
    });
  });
}

/** Crea el directorio padre del gitdir (propiedad del banco, no escribible por el agente). */
export function ensureGitDirParent(gitDir: string): void {
  mkdirSync(join(gitDir, ".."), { recursive: true, mode: 0o700 });
}

/** `git archive <commit> | tar -x -C dest` sin shell. */
export function gitArchiveTo(repo: string, commit: string, dest: string, timeoutMs = 120_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const a = spawn("git", ["archive", "--format=tar", commit], { cwd: repo, env: gitEnv(), stdio: ["ignore", "pipe", "pipe"] });
    const t = spawn("tar", ["-x", "-C", dest], { stdio: ["pipe", "ignore", "pipe"] });
    let err = "";
    a.stderr.on("data", (d: Buffer) => { err += d.toString(); });
    t.stderr.on("data", (d: Buffer) => { err += d.toString(); });
    a.stdout.pipe(t.stdin);
    const timer = setTimeout(() => { a.kill("SIGKILL"); t.kill("SIGKILL"); }, timeoutMs);
    let codes: Array<number | null> = [];
    const done = () => {
      codes.length === 2 && (clearTimeout(timer), codes.every((c) => c === 0) ? resolve() : reject(new Error(`git archive/tar falló: ${err.trim()}`)));
    };
    a.on("error", (e) => { clearTimeout(timer); reject(e); });
    t.on("error", (e) => { clearTimeout(timer); reject(e); });
    a.on("close", (c) => { codes.push(c); done(); });
    t.on("close", (c) => { codes.push(c); done(); });
  });
}
