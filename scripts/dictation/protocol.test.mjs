// Ejecutar: node --test scripts/dictation/protocol.test.mjs
// Sin microfono. Si LAZUNOX_DICTATE_BIN apunta al binario compilado, tambien valida su --self-test.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { test } from 'node:test'
import { canGo, MAX_TEXT_BYTES, parseLine, replay } from './protocol.mjs'

test('lineas validas', () => {
  assert.equal(parseLine('{"type":"partial","text":"hola","ms":3}').text, 'hola')
  assert.equal(parseLine('{"type":"final","text":"Hola, ¿qué tal?"}').type, 'final')
  assert.equal(parseLine('{"type":"state","state":"listening"}').state, 'listening')
  assert.equal(parseLine('{"type":"error","code":"no-disponible"}').code, 'no-disponible')
})

test('basura, tipos desconocidos y limites se ignoran', () => {
  for (const bad of [
    '',
    'no json',
    '[]',
    'null',
    '{"type":"audio"}',
    '{"type":"partial"}',
    '{"type":"partial","text":5}',
    '{"type":"state"}',
    '{"type":"error"}'
  ])
    assert.equal(parseLine(bad), null, bad)
  assert.equal(parseLine(JSON.stringify({ type: 'final', text: 'a'.repeat(MAX_TEXT_BYTES + 1) })), null)
  assert.equal(parseLine('{"type":"partial","text":"' + 'a'.repeat(70000) + '"}'), null)
})

test('maquina de estados: transiciones', () => {
  assert.ok(canGo('idle', 'starting') && canGo('starting', 'listening') && canGo('listening', 'finishing') && canGo('finishing', 'stopped'))
  assert.ok(!canGo('stopped', 'listening') && !canGo('idle', 'listening') && !canGo('finishing', 'listening'))
})

test('replay: sesion normal y texto antes de escuchar', () => {
  const ev = (o) => o
  const ok = replay([
    ev({ type: 'state', state: 'starting' }),
    ev({ type: 'state', state: 'listening' }),
    ev({ type: 'partial', text: 'ho' }),
    ev({ type: 'final', text: 'Hola' }),
    ev({ type: 'state', state: 'finishing' }),
    ev({ type: 'state', state: 'stopped' })
  ])
  assert.deepEqual([ok.phase, ok.finals, ok.partial, ok.violations], ['stopped', ['Hola'], '', 0])
  assert.equal(replay([{ type: 'partial', text: 'x' }]).violations, 1)
  assert.equal(
    replay([
      { type: 'state', state: 'stopped' },
      { type: 'state', state: 'listening' }
    ]).violations,
    2
  )
})

test('--self-test del binario (si existe)', { skip: !process.env.LAZUNOX_DICTATE_BIN }, () => {
  const out = execFileSync(process.env.LAZUNOX_DICTATE_BIN, ['--self-test'], { encoding: 'utf8' })
  const events = out
    .trim()
    .split('\n')
    .map((l) => parseLine(l))
  assert.ok(events.every(Boolean), 'todas las lineas parsean')
  const r = replay(events)
  assert.equal(r.violations, 0)
  assert.equal(r.phase, 'stopped')
  assert.deepEqual(r.finals, ['Hola, ¿qué tal?'])
  assert.equal(events.at(-1).state, 'self-test-ok')
})
