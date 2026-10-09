import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cartTotal } from '../src/cart.ts';
import { roundCents } from '../src/money.ts';

test('redondeo al centimo mas cercano', () => {
  assert.equal(cartTotal([{ price: 4.46, qty: 1 }]), 5.31);
});

test('varias lineas', () => {
  assert.equal(cartTotal([{ price: 19.99, qty: 3 }, { price: 5.5, qty: 2 }]), 84.45);
});

test('vacio y cantidad cero', () => {
  assert.equal(cartTotal([]), 0);
  assert.equal(cartTotal([{ price: 9, qty: 0 }]), 0);
});

test('roundCents', () => {
  assert.equal(roundCents(0.125), 0.13);
});
