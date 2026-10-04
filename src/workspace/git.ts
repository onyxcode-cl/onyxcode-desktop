import { spawn } from "node:child_process";

const GIT_ENV = {
  PATH: process.env.PATH ?? "/usr/bin:/bin",
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_TERMINAL_PROMPT: "0",
  LC_ALL: "C",
};

/** Ejecuta git con entorno limpio (sin config global ni hooks del usuario). Rechaza si sale != 0. */
export function git(cwd: string, args: string[], timeoutMs = 60_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("git", ["-c", "core.hooksPath=/dev/null", "-c", "commit.gpgsign=false", ...args], {
      cwd, env: GIT_ENV, stdio: ["ignore", "pipe", "pipe"],
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

/** `git archive <commit> | tar -x -C dest` sin shell. */
export function gitArchiveTo(repo: string, commit: string, dest: string, timeoutMs = 120_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const a = spawn("git", ["archive", "--format=tar", commit], { cwd: repo, env: GIT_ENV, stdio: ["ignore", "pipe", "pipe"] });
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
