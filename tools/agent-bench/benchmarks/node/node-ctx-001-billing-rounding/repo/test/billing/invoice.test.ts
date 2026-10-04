import { test } from 'node:test';
import assert from 'node:assert/strict';
import { invoiceTotal } from '../../src/billing/invoice.ts';

test('una linea', () => {
  assert.equal(invoiceTotal([{ unitPrice: 10, qty: 3, taxPct: 19 }]), 35.7);
});
