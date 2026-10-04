import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEmitter } from '../src/index.ts';

test('off quita solo ese handler', () => {
  const e = createEmitter();
  const calls: string[] = [];
  const a = () => calls.push('a');
  const b = () => calls.push('b');
  const c = () => calls.push('c');
  e.on('x', a).on('x', b).on('x', c);
  e.off('x', b);
  e.emit('x');
  assert.deepEqual(calls, ['a', 'c']);
});

test('once se ejecuta una vez y no salta handlers', () => {
  const e = createEmitter();
  const calls: string[] = [];
  e.once('x', () => calls.push('once'));
  e.on('x', () => calls.push('on'));
  assert.equal(e.emit('x'), true);
  assert.equal(e.emit('x'), true);
  assert.deepEqual(calls, ['once', 'on', 'on']);
});

test('emit sin handlers devuelve false', () => {
  assert.equal(createEmitter().emit('nada'), false);
});

test('instancias independientes', () => {
  const a = createEmitter();
  const b = createEmitter();
  let n = 0;
  a.on('x', () => n++);
  b.emit('x');
  assert.equal(n, 0);
});
