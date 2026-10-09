import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeConfig } from '../src/merge.ts';

test('no muta las entradas', () => {
  const a = { n: { x: 1 }, l: [1] };
  const b = { n: { y: 2 }, l: [2] };
  mergeConfig(a, b);
  assert.deepEqual(a, { n: { x: 1 }, l: [1] });
  assert.deepEqual(b, { n: { y: 2 }, l: [2] });
});

test('no comparte referencias anidadas', () => {
  const a = { n: { x: { deep: 1 } } };
  const b = { m: { z: 1 }, l: [{ k: 1 }] };
  const out = mergeConfig(a, b);
  out.n.x.deep = 99;
  out.m.z = 99;
  out.l[0].k = 99;
  assert.equal(a.n.x.deep, 1);
  assert.equal(b.m.z, 1);
  assert.equal(b.l[0].k, 1);
});

test('arrays se reemplazan (ADR-007)', () => {
  assert.deepEqual(mergeConfig({ l: [1, 2] }, { l: [3] }), { l: [3] });
});
