import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Stock } from '../src/inventory/stock.ts';
import { summary } from '../src/inventory/report.ts';

test('reservas parciales dentro de lo disponible', () => {
  const s = new Stock();
  s.add('a', 10);
  s.reserve('a', 3);
  s.reserve('a', 7);
  assert.equal(s.available('a'), 0);
  assert.throws(() => s.reserve('a', 1), /insufficient stock/);
});

test('cantidad invalida', () => {
  const s = new Stock();
  s.add('a', 10);
  assert.throws(() => s.reserve('a', 0), RangeError);
  assert.throws(() => s.reserve('a', -2), RangeError);
});

test('summary calcula available', () => {
  const s = new Stock();
  s.add('a', 10);
  s.add('b', 4);
  s.reserve('a', 4);
  assert.deepEqual(summary(s, ['a', 'b']), [
    { sku: 'a', onHand: 10, reserved: 4, available: 6 },
    { sku: 'b', onHand: 4, reserved: 0, available: 4 },
  ]);
});

test('release devuelve disponibilidad', () => {
  const s = new Stock();
  s.add('a', 5);
  s.reserve('a', 5);
  s.release('a', 2);
  assert.equal(s.available('a'), 2);
});
