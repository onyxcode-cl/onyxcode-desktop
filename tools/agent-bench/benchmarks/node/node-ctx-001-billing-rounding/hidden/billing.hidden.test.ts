import { test } from 'node:test';
import assert from 'node:assert/strict';
import { invoiceTotal } from '../src/billing/invoice.ts';
import { roundCents } from '../src/billing/rounding.ts';

test('mitad hacia arriba', () => {
  assert.equal(roundCents(0.125), 0.13);
});

test('redondeo unico al final', () => {
  const line = { unitPrice: 0.1, qty: 1, taxPct: 5 };
  assert.equal(invoiceTotal([line, line]), 0.21);
});
