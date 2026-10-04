import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Stock } from '../../src/inventory/stock.ts';

test('no se puede reservar mas de lo disponible', () => {
  const s = new Stock();
  s.add('a', 5);
  s.reserve('a', 3);
  assert.throws(() => s.reserve('a', 3), /insufficient stock/);
});
