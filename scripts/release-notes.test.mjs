import assert from 'node:assert/strict'
import { test } from 'node:test'
import { extractNotes } from './release-notes.mjs'

const LOG = `# Cambios

Texto de introducción.

## [Sin publicar]

### Añadido
- Algo futuro.

## [0.4.0] - 2026-11-01

### Añadido
- Actualización automática.

### Corregido
- Un error.

## [0.3.0] - 2026-09-01

- Versión anterior.

[Sin publicar]: https://example.test/compare/v0.4.0...HEAD
[0.4.0]: https://example.test/compare/v0.3.0...v0.4.0
`

test('extrae solo la sección de la versión pedida (con o sin «v»)', () => {
  const n = extractNotes(LOG, '0.4.0')
  assert.match(n, /^### Añadido\n- Actualización automática\./)
  assert.match(n, /### Corregido\n- Un error\.\n$/)
  assert.ok(!n.includes('Versión anterior') && !n.includes('Algo futuro'))
  assert.equal(extractNotes(LOG, 'v0.4.0'), n)
})

test('la última sección se corta antes del bloque de enlaces', () => {
  const n = extractNotes(LOG.replace('## [0.3.0] - 2026-09-01\n\n- Versión anterior.\n', '') + '\n', '0.4.0')
  assert.ok(!n.includes('example.test'))
})

test('falla con versión inexistente, sección vacía o versión mal escrita', () => {
  assert.throws(() => extractNotes(LOG, '9.9.9'), /no tiene una sección/)
  assert.throws(() => extractNotes('## [1.0.0] - 2026-01-01\n\n## [0.9.0]\n- x\n', '1.0.0'), /vacía/)
  assert.throws(() => extractNotes(LOG, 'abc'), /no válida/)
  assert.throws(() => extractNotes(LOG, '0.4'), /no válida/)
  // 0.4.0 no debe casar con 0.4.01 ni con 10.4.0
  assert.throws(() => extractNotes('## [10.4.0]\n- x\n', '0.4.0'), /no tiene/)
})

test('admite prereleases y encabezados sin corchetes', () => {
  assert.equal(extractNotes('## 0.5.0-beta.1 - 2026-12-01\n- beta\n', '0.5.0-beta.1'), '- beta\n')
})
