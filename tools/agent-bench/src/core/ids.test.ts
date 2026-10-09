import { test } from "node:test";
import assert from "node:assert/strict";
import { canonicalJson, contentHash, deterministicId, newRunId, runId8, seededRng, seededShuffle } from "./ids.ts";

test("runId8 toma 8 hex", () => {
  const id = newRunId();
  assert.match(runId8(id), /^[0-9a-f]{8}$/);
  assert.throws(() => runId8("zz"));
});
test("canonicalJson ordena claves y es estable", () => {
  assert.equal(canonicalJson({ b: 1, a: [2, { d: 1, c: undefined }] }), '{"a":[2,{"d":1}],"b":1}');
  assert.equal(contentHash({ a: 1, b: 2 }), contentHash({ b: 2, a: 1 }));
  assert.equal(deterministicId("x", 1), deterministicId("x", 1));
  assert.notEqual(deterministicId("x", 1), deterministicId("x", 2));
});
test("rng y shuffle son deterministas por semilla", () => {
  const a = seededRng(42), b = seededRng(42);
  assert.deepEqual([a(), a(), a()], [b(), b(), b()]);
  const items = [1, 2, 3, 4, 5, 6, 7, 8];
  assert.deepEqual(seededShuffle(items, 7), seededShuffle(items, 7));
  assert.deepEqual([...seededShuffle(items, 7)].sort(), items);
  assert.deepEqual(items, [1, 2, 3, 4, 5, 6, 7, 8]);
});
