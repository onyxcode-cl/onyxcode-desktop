import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { CodexRunner } from "../../src/runners/codex/index.ts";
import { cfg, limits, makeCtx, pgrepCount, readOut } from "./helpers.ts";

const KEY = "sk-CODEXSECRETSECRET0123456789";

async function exec(scenario: string, lim = limits(), signal?: AbortSignal, extra: Record<string, unknown> = {}) {
  const { ctx, root, done } = makeCtx({ CODEX_API_KEY: KEY });
  const runner = new CodexRunner();
  const prepared = await runner.prepare(ctx, cfg("codex", "fake-codex.ts", scenario, extra));
  const raw = await runner.run(prepared, { scenarioId: "s1", prompt: "haz algo (prompt)" }, lim, signal ?? new AbortController().signal);
  const collected = await runner.collect(prepared, raw);
  const clean = await runner.cleanup(prepared);
  return { ctx, root, done, raw, collected, clean, home: join(root, "codex-home") };
}

test("codex ok: flags, tokens, rollout deduplicado, nulls declarados, sin secretos", async () => {
  const r = await exec("ok", limits(), undefined, { reasoningEffort: "low" });
  try {
    assert.equal(r.raw.outcome, "completed");
    assert.equal(r.clean.orphans, 0);
    const a = JSON.parse(readFileSync(join(r.home, "argv.json"), "utf8"));
    for (const f of ["exec", "--json", "--skip-git-repo-check", "--ignore-user-config"]) assert.ok(a.argv.includes(f), f);
    assert.equal(a.argv[a.argv.indexOf("-s") + 1], "workspace-write");
    assert.equal(a.argv[a.argv.indexOf("-m") + 1], "fakemodel");
    assert.equal(a.argv[a.argv.indexOf("-C") + 1], r.ctx.workspace);
    assert.ok(a.argv.includes('model_reasoning_effort="low"'));
    assert.equal(a.prompt, "haz algo (prompt)");
    assert.equal(a.home, r.ctx.home);
    assert.ok(a.keys.includes("CODEX_HOME") && !a.keys.includes("USER") && !a.keys.includes("SHELL"));

    const t = r.collected.telemetry;
    assert.equal(t.inputTokens, 1000);
    assert.equal(t.cachedTokens, 600);
    assert.equal(t.outputTokens, 200);
    assert.equal(t.reasoningTokens, 50);
    assert.equal(t.totalTokens, 1200);
    assert.equal(t.llmCalls, 2); // 4 token_count con totales -> 2 distintos
    assert.equal(t.peakContext, 700);
    assert.equal(t.costUsd, null);
    assert.equal(t.filesRead, null);
    assert.equal(t.steps, null);
    assert.equal(t.commands, 2); // i2 duplicado no cuenta
    assert.equal(t.toolCalls, 3);
    assert.deepEqual(t.filesCreated, ["out.txt"]);
    assert.deepEqual(t.filesModified, ["a.ts"]);
    assert.equal((t.extra.rollout as { duplicatesDropped: number }).duplicatesDropped, 2);
    assert.equal(t.extra.commandFailures, 1);

    const out = readOut(r.ctx.out);
    assert.ok(!out.includes("CODEXSECRET"));
  } finally {
    r.done();
  }
});

test("codex ratelimit => rate_limited; turn.failed/crash => agent_error", async () => {
  const a = await exec("ratelimit");
  try {
    assert.equal(a.raw.outcome, "rate_limited");
    assert.equal(a.clean.orphans, 0);
  } finally {
    a.done();
  }
  for (const s of ["turnfail", "crash"]) {
    const b = await exec(s);
    try {
      assert.equal(b.raw.outcome, "agent_error", s);
      assert.equal(b.collected.telemetry.inputTokens, null); // sin usage => null, no 0
    } finally {
      b.done();
    }
  }
});

test("codex hang => hung (180 s en prod, aquí reducido); timeout; cancel < 10 s", async () => {
  const h = await exec("hang", limits({ inactivitySec: 0.8 }));
  try {
    assert.equal(h.raw.outcome, "hung");
    assert.equal(h.clean.orphans, 0);
  } finally {
    h.done();
  }
  const t = await exec("slow", limits({ timeoutSec: 1 }));
  try {
    assert.equal(t.raw.outcome, "timeout");
  } finally {
    t.done();
  }
  const ac = new AbortController();
  setTimeout(() => ac.abort(), 600);
  const t0 = Date.now();
  const c = await exec("slow", limits(), ac.signal);
  try {
    assert.equal(c.raw.outcome, "cancelled");
    assert.ok(Date.now() - t0 < 10_000);
  } finally {
    c.done();
  }
});

test("codex orphan: nieto desligado se mata; tope de pasos", async () => {
  const o = await exec("orphan");
  try {
    assert.equal(o.raw.outcome, "completed");
    assert.equal(o.clean.orphans, 0);
    assert.equal(pgrepCount("sleep 318"), 0);
  } finally {
    o.done();
  }
  const m = await exec("ok", limits({ maxSteps: 1 }));
  try {
    assert.equal((m.raw.raw as { stopReason: string }).stopReason, "max_steps");
    assert.equal(m.raw.outcome, "completed");
  } finally {
    m.done();
  }
});

test("codex probe con binario simulado", async () => {
  const runner = new CodexRunner({ bin: { cmd: process.execPath, args: [new URL("./fake-codex.ts", import.meta.url).pathname] } });
  const p = await runner.probe();
  assert.equal(p.available, true);
  assert.equal(p.version, "0.0.0-fake");
});
