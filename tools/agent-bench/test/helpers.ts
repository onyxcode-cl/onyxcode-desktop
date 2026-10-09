import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const GENV = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" };
export function sh(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, env: GENV, encoding: "utf8" });
}
export function tmp(): string { return mkdtempSync(join(tmpdir(), "ab-test-")); }
export function cleanup(...dirs: string[]): void { for (const d of dirs) rmSync(d, { recursive: true, force: true }); }
export function put(root: string, files: Record<string, string>): void {
  for (const [p, c] of Object.entries(files)) { mkdirSync(dirname(join(root, p)), { recursive: true }); writeFileSync(join(root, p), c); }
}
/** Repo fixture mínimo con 2 commits (para probar que no se hereda historia). */
export function makeFixture(root: string): { repo: string; commit: string } {
  const repo = join(root, "fixture");
  mkdirSync(repo);
  sh(repo, "init", "-q", "-b", "main");
  put(repo, {
    "package.json": '{"type":"module"}\n',
    "src/add.js": "export function add(a, b) { return a - b; }\n",
    "test/add.test.js": "import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { add } from '../src/add.js';\ntest('add', () => { assert.equal(add(2, 3), 5); });\n",
  });
  sh(repo, "add", "-A");
  sh(repo, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "uno");
  put(repo, { "later.txt": "no debe estar\n" });
  sh(repo, "add", "-A");
  sh(repo, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "dos");
  const commit = sh(repo, "rev-parse", "HEAD~1").trim();
  return { repo, commit };
}
