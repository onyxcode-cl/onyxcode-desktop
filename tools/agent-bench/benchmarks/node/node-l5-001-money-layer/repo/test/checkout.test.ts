import { test } from 'node:test';
import assert from 'node:assert/strict';
import { receiptLine } from '../src/checkout.ts';

test('linea de recibo', () => {
  assert.equal(receiptLine('Te', 1999), 'Te: $19.99');
});
