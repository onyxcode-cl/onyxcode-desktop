import { test } from "node:test";
import assert from "node:assert/strict";
import { REDACTED, containsSecret, redactDeep, redactEnv, redactText } from "./redact.ts";

test("redacta claves y tokens conocidos", () => {
  const t = "key sk-abcdefghijklmnopqrstuv and Bearer abcdefgh12345678 and ghp_" + "a".repeat(30);
  const r = redactText(t);
  assert.ok(!r.includes("sk-abc") && !r.includes("abcdefgh12345678") && !r.includes("ghp_aaa"));
  assert.ok(r.includes(REDACTED));
});
test("redacta asignaciones y secretos extra", () => {
  assert.equal(redactText('api_key="hunter22xyz"'), `api_key="${REDACTED}"`);
  assert.equal(redactText("pw=correcthorse", ["correcthorse"]).includes("correcthorse"), false);
});
test("redactEnv por nombre de clave", () => {
  const e = redactEnv({ OPENAI_API_KEY: "abc123456", PATH: "/usr/bin", OPENCODE_AUTH_CONTENT: "{}x" });
  assert.equal(e.OPENAI_API_KEY, REDACTED);
  assert.equal(e.OPENCODE_AUTH_CONTENT, REDACTED);
  assert.equal(e.PATH, "/usr/bin");
});
test("redactDeep no muta y cubre anidados", () => {
  const src = { a: { token: "zzzzzzzz", n: 1, l: ["sk-abcdefghijklmnopqrstuv"] } };
  const out = redactDeep(src);
  assert.equal(out.a.token, REDACTED);
  assert.equal(out.a.l[0], REDACTED);
  assert.equal(src.a.token, "zzzzzzzz");
  assert.equal(out.a.n, 1);
});
test("containsSecret", () => {
  assert.equal(containsSecret("hola mundo"), false);
  assert.equal(containsSecret("sk-abcdefghijklmnopqrstuv"), true);
});
