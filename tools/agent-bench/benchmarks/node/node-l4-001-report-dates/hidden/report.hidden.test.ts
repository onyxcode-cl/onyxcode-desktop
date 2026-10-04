import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildHeader, formatReportDate } from '../src/report.ts';

test('fecha ISO en UTC', () => {
  assert.equal(formatReportDate(new Date(Date.UTC(2026, 0, 5, 12))), '2026-01-05');
});

test('independiente de la zona horaria del servidor', () => {
  assert.equal(formatReportDate(new Date('2026-01-05T02:30:00Z')), '2026-01-05');
  assert.equal(formatReportDate(new Date('2026-03-01T23:30:00-05:00')), '2026-03-02');
});

test('encabezado', () => {
  assert.equal(buildHeader('Ventas', new Date(Date.UTC(2026, 0, 5))), 'Informe: Ventas (2026-01-05)');
});
