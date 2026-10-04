import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { ConfigurationSchema, LimitsSchema } from "../../src/core/schemas.ts";
import type { Configuration, Limits, RunContext } from "../../src/core/schemas.ts";

export const HERE = new URL(".", import.meta.url).pathname;

export function makeCtx(env: Record<string, string> = {}): { ctx: RunContext; root: string; done: () => void } {
  const root = mkdtempSync(join(tmpdir(), "abrr-"));
  const ctx: RunContext = {
    runId: "11111111-2222-3333-4444-555555555555",
    runRoot: root,
    workspace: join(root, "ws"),
    home: join(root, "home"),
    tmp: join(root, "tmp"),
    out: join(root, "out"),
    env: { PATH: process.env.PATH ?? "", ...env },
    seed: 1,
  };
  for (const d of [ctx.workspace, ctx.home, ctx.tmp, ctx.out]) mkdirSync(d, { recursive: true });
  return { ctx, root, done: () => rmSync(root, { recursive: true, force: true }) };
}

export function cfg(runner: string, fakeScript: string, scenario: string, extra: Record<string, unknown> = {}): Configuration {
  return ConfigurationSchema.parse({
    schemaVersion: "1", id: `${runner}-test`, name: "test", runner, provider: "fakeprov", model: "fakemodel",
    settings: { bin: { cmd: process.execPath, args: [HERE + fakeScript, scenario] }, ...extra },
  });
}

export function limits(over: Partial<Limits> = {}): Limits {
  return LimitsSchema.parse({ timeoutSec: 20, inactivitySec: 10, maxSteps: 60, ...over });
}

export function readOut(dir: string): string {
  return readdirSync(dir).map((f) => readFileSync(join(dir, f), "utf8")).join("\n");
}

export function pgrepCount(pattern: string): number {
  const r = spawnSync("pgrep", ["-f", pattern], { encoding: "utf8" });
  return (r.stdout ?? "").split("\n").filter((l) => l.trim()).length;
}
