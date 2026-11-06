// Prueba del modulo puro de scripts/win/parity-check.mjs.  node --test scripts/win-parity-lib.test.mjs
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { compararParidad, desenvolverEstado, formatearInforme, parsearInforme } from './win/parity-lib.mjs'

const tabla = JSON.parse(readFileSync(new URL('../docs/PARIDAD-WINDOWS.json', import.meta.url), 'utf8'))
const bien = () => ({
  platform: 'win32',
  capsFlags: { tasksWin: true, computerWin: true, remoteWin: true, pythonWin: true, glass: true },
  sandbox: { backend: 'wsl', state: 'ready' }
})

test('coincide: OK y exit logico 0', () => {
  const r = compararParidad(tabla, bien())
  assert.equal(r.ok, true)
  assert.equal(r.elevada, false)
})

test('bandera distinta y plataforma distinta fallan', () => {
  const o = bien()
  o.capsFlags.pythonWin = false
  o.platform = 'darwin'
  const r = compararParidad(tabla, o)
  assert.equal(r.ok, false)
  assert.equal(r.fallos, 2)
})

test('sin administrador: unsupported es puerta cerrada y falla', () => {
  const o = bien()
  o.sandbox = { backend: 'wsl', state: 'unsupported', detail: 'flag' }
  assert.equal(compararParidad(tabla, o).ok, false)
})

test('backend distinto falla', () => {
  const o = bien()
  o.sandbox.backend = 'none'
  assert.equal(compararParidad(tabla, o).ok, false)
})

test('sesion elevada: aviso, no fallo; con --exigir-sin-admin falla', () => {
  const o = bien()
  o.sandbox = { backend: 'wsl', state: 'unsupported', detail: 'elevated' }
  const r = compararParidad(tabla, o)
  assert.equal(r.ok, true)
  assert.equal(r.elevada, true)
  assert.ok(r.filas.some((f) => f.estado === 'AVISO'))
  assert.equal(compararParidad(tabla, o, { exigirSinAdmin: true }).ok, false)
})

test('error de lectura y sandbox ausente fallan', () => {
  assert.equal(compararParidad(tabla, { error: 'sin CDP' }).ok, false)
})

test('desenvolverEstado acepta con y sin sobre {ok,data}', () => {
  assert.deepEqual(desenvolverEstado({ ok: true, data: { state: 'ready' } }), { state: 'ready' })
  assert.deepEqual(desenvolverEstado({ state: 'ready' }), { state: 'ready' })
})

test('informe: se formatea y se parsea de vuelta', () => {
  for (const [o, ok] of [[bien(), true], [{ ...bien(), platform: 'linux' }, false]]) {
    const txt = formatearInforme(compararParidad(tabla, o))
    const p = parsearInforme(txt)
    assert.equal(p.ok, ok)
    assert.equal(p.resultado, ok ? 'OK' : 'FALLA')
    assert.equal(p.filas.some((f) => f.estado === 'FALLA'), !ok)
  }
  const el = bien()
  el.sandbox = { backend: 'wsl', state: 'unsupported', detail: 'elevated' }
  const p = parsearInforme(formatearInforme(compararParidad(tabla, el)))
  assert.equal(p.ok, true)
  assert.equal(p.elevada, true)
})
