import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLine } from '../src/csv.ts';
import { toObjects } from '../src/table.ts';

test('comillas escapadas', () => {
  assert.deepEqual(parseLine('"di ""hola""",x'), ['di "hola"', 'x']);
});

test('campos vacios', () => {
  assert.deepEqual(parseLine('a,,"",d,'), ['a', '', '', 'd', '']);
});

test('toObjects con CRLF y lineas en blanco', () => {
  const rows = toObjects('n,v\r\nuno,"1,5"\r\n\r\ndos,2\r\n');
  assert.deepEqual(rows, [
    { n: 'uno', v: '1,5' },
    { n: 'dos', v: '2' },
  ]);
});
