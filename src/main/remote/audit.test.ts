import { mkdtempSync, readFileSync, rmSync, statSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AuditLog, sanitizeAudit, type AuditInput } from './audit'

let dir: string
let file: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'audit-'))
  file = join(dir, 'remote-audit.jsonl')
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('AuditLog', () => {
  it('guarda una línea por suceso y lista lo más nuevo primero, con filtro por dispositivo', () => {
    let t = 1000
    const log = new AuditLog(file, { now: () => t++ })
    log.append({ kind: 'paired', device: 'aaaaaaaa', name: 'iPhone' })
    log.append({ kind: 'connected', device: 'bbbbbbbb', name: 'Pixel' })
    log.append({ kind: 'pin-fail', device: 'aaaaaaaa', n: 2 })
    expect(readFileSync(file, 'utf8').trim().split('\n')).toHaveLength(3)
    expect(log.list().map((e) => e.kind)).toEqual(['pin-fail', 'connected', 'paired'])
    expect(log.list({ device: 'aaaaaaaa' }).map((e) => e.kind)).toEqual(['pin-fail', 'paired'])
    expect(log.list({ limit: 1 })).toHaveLength(1)
  })

  it('rota a 2 archivos al pasar el tamaño máximo y nunca crece sin límite', () => {
    const log = new AuditLog(file, { maxBytes: 400 })
    for (let i = 0; i < 60; i++) log.append({ kind: 'connected', device: 'aaaaaaaa', name: 'Pixel' })
    expect(existsSync(`${file}.1`)).toBe(true)
    expect(existsSync(`${file}.2`)).toBe(false)
    expect(statSync(file).size).toBeLessThanOrEqual(400)
    expect(statSync(`${file}.1`).size).toBeLessThanOrEqual(400)
    // La lista lee ambos archivos.
    expect(log.list({ limit: 1000 }).length).toBeGreaterThan(statSync(file).size / 100)
  })

  it('descarta campos desconocidos y no guarda secretos ni payloads', () => {
    const log = new AuditLog(file)
    const dirty = {
      kind: 'policy-denied',
      device: 'aaaaaaaa',
      ch: 'git:removeWorktree',
      cls: 'X',
      pin: '123456',
      secret: 'S'.repeat(43),
      payload: { path: '/Users/ben/secreto.txt' },
      deviceSecret: 'zzz'
    } as unknown as AuditInput
    log.append(dirty)
    log.append({ kind: 'policy-denied', ch: '/Users/ben/secreto.txt\nOtraLinea{"x":1}' })
    const raw = readFileSync(file, 'utf8')
    for (const s of ['123456', 'SSSSSS', 'secreto', 'deviceSecret', 'payload', 'pin"']) expect(raw).not.toContain(s)
    expect(raw.trim().split('\n')).toHaveLength(2)
    const [second, first] = log.list()
    expect(first).toMatchObject({ kind: 'policy-denied', ch: 'git:removeWorktree', cls: 'X' })
    expect(second?.ch).toBe('?')
  })

  it('un tipo desconocido o un dispositivo mal formado no se guardan tal cual', () => {
    expect(sanitizeAudit({ kind: 'otro' as never }, 1)).toBeNull()
    expect(sanitizeAudit({ kind: 'paired', device: 'no-es-huella' }, 1)).toEqual({ ts: 1, kind: 'paired' })
  })

  it('auth-bad-proof (intento sin la clave correcta) se acepta y solo guarda huella y nombre', () => {
    expect(sanitizeAudit({ kind: 'auth-bad-proof', device: 'abcdef12', name: 'iPhone', why: 'hs3' }, 7)).toEqual({
      ts: 7,
      kind: 'auth-bad-proof',
      device: 'abcdef12',
      name: 'iPhone',
      why: 'hs3'
    })
    const log = new AuditLog(file)
    log.append({ kind: 'auth-bad-proof', device: 'abcdef12', name: 'iPhone', secret: 'x'.repeat(43) } as unknown as AuditInput)
    expect(readFileSync(file, 'utf8')).not.toContain('xxxx')
  })

  it('no lanza aunque no se pueda escribir', () => {
    const log = new AuditLog(join(dir, 'archivo-no-dir', '\0malo', 'a.jsonl'))
    expect(() => log.append({ kind: 'stopped' })).not.toThrow()
    expect(log.list()).toEqual([])
  })
})
