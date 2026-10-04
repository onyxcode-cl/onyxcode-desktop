import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cartTotal } from '../src/cart.ts';

test('una linea con cantidad', () => {
  assert.equal(cartTotal([{ price: 10, qty: 2 }]), 23.8);
});
