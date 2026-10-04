import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildHeader } from '../src/report.ts';

test('el encabezado empieza con el titulo', () => {
  const h = buildHeader('Ventas', new Date(Date.UTC(2026, 0, 5, 12)));
  assert.ok(h.startsWith('Informe: Ventas ('));
});
