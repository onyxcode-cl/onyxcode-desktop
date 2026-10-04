import { test } from 'node:test';
import assert from 'node:assert/strict';
import { receiptLine } from '../src/checkout.ts';
import { invoiceTotal } from '../src/invoice.ts';
import { formatMoney } from '../src/money.ts';

test('receiptLine con otros montos', () => {
  assert.equal(receiptLine('Pan', 5), 'Pan: $0.05');
  assert.equal(receiptLine('Tele', 100000), 'Tele: $1,000.00');
});

test('invoiceTotal sigue en dolares', () => {
  assert.equal(invoiceTotal([19.99, 5]), '$24.99');
});

test('formatMoney recibe dolares', () => {
  assert.equal(formatMoney(19.99), '$19.99');
});
