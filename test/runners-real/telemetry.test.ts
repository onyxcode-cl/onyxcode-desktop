import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { InactivityWatch, isRateLimitText } from "../../src/telemetry/detect.ts";
import { nmax, normalizeTelemetry, nsum } from "../../src/telemetry/normalize.ts";
import { NO_CAPABILITIES } from "../../src/core/schemas.ts";
import { extractOpenCode } from "../../src/runners/opencode/extract.ts";
import { parseJsonl } from "../../src/runners/codex/events.ts";
import { extractCodex } from "../../src/runners/codex/extract.ts";
import { HERE } from "./helpers.ts";

test("nsum/nmax devuelven null sin datos, nunca 0", () => {
  assert.equal(nsum(null, undefined), null);
  assert.equal(nsum(null, 2, 3), 5);
  assert.equal(nmax([null]), null);
  assert.equal(nmax([1, null, 4]), 4);
});

test("normalizeTelemetry aplica capabilities y runner_specific en extra", () => {
  const t = normalizeTelemetry({ inputTokens: 5, costUsd: 1, toolCalls: 3 }, { ...NO_CAPABILITIES, tokens: true }, { foo: "bar" });
  assert.equal(t.inputTokens, 5);
  assert.equal(t.costUsd, null);
  assert.equal(t.toolCalls, null);
  assert.equal(t.extra.foo, "bar");
  assert.equal(t.schemaVersion, "1");
});

test("isRateLimitText", () => {
  for (const s of ["token rate limit exceeded", "HTTP 429 Too Many Requests", "Rate limit reached", "usage limit hit"]) assert.ok(isRateLimitText(s), s);
  for (const s of ["syntax error at line 429x", "all good", "", null, undefined]) assert.ok(!isRateLimitText(s as string), String(s));
});

test("InactivityWatch con reloj simulado", () => {
  let now = 0;
  const w = new InactivityWatch(180_000, () => now);
  now = 179_000;
  assert.equal(w.expired(), false);
  w.touch();
  now = 179_000 + 181_000;
  assert.equal(w.expired(), true);
});

test("OpenCode: fixture sin tokens de coste => null; herramientas leídas/escritas", () => {
  const msgs = JSON.parse(readFileSync(HERE + "fixtures/opencode-messages.json", "utf8"));
  const t = extractOpenCode({ main: msgs, children: {}, diff: [], retries: 0, source: "http", unverified: [] });
  assert.equal(t.costUsd, null);
  assert.equal(t.inputTokens, 15); // 10 + cache.read 5
  assert.equal(t.outputTokens, 5); // 4 + reasoning 1
  assert.equal(t.cachedTokens, 5);
  assert.equal(t.llmCalls, 1); // sin step-finish: nº de mensajes assistant
  assert.equal(t.steps, null);
  assert.deepEqual(t.filesModified, ["a.ts"]);
  assert.deepEqual(t.filesRead, ["src"]);
  assert.equal(t.filesCreated, null); // /diff sin status
  assert.equal(t.extra.toolDurationMs, 2);
});

test("OpenCode: sin mensajes => todo null (no 0)", () => {
  const t = extractOpenCode({ main: [], children: {}, diff: [], retries: 0, source: "http", unverified: [] });
  assert.equal(t.inputTokens, null);
  assert.equal(t.totalTokens, null);
  assert.equal(t.costUsd, null);
  assert.equal(t.llmCalls, null);
});

test("Codex: parseo tolerante (línea inválida, evento desconocido) y nulls declarados", () => {
  const p = parseJsonl(readFileSync(HERE + "fixtures/codex-events.jsonl", "utf8"));
  assert.equal(p.malformedLines, 1);
  assert.equal(p.unknownEventTypes["mystery.event"], 1);
  const t = extractCodex(p, null, []);
  assert.equal(t.inputTokens, 50);
  assert.equal(t.totalTokens, 57);
  assert.equal(t.costUsd, null);
  assert.equal(t.llmCalls, null); // sin rollout
  assert.equal(t.peakContext, null);
  assert.equal(t.filesRead, null);
  assert.deepEqual(t.filesModified, ["x.ts"]);
  assert.ok((t.extra.declaredNulls as string[]).includes("costUsd"));
});
