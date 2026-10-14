import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { PROBLEM_SOURCES, ProblemLog } from './problem-log'
import { IPC_SCHEMAS } from '../ipc/schemas'

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'lzx-problems-doc-'))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('origen «documento» del registro de problemas', () => {
  it('es un origen válido y se muestra como «documento»', () => {
    expect(PROBLEM_SOURCES).toContain('document')
    const log = new ProblemLog({ dir, now: () => new Date(2026, 9, 14, 12, 0, 0).getTime(), home: '/Users/ben' })
    log.record({
      source: 'document',
      level: 'warn',
      message: 'documento de Chat (pptx) no se pudo usar: JSON inválido',
      detail: { tipo: 'pptx' }
    })
    expect(log.readLines()[0]).toBe('2026-10-14 12:00:00 [aviso] [documento] documento de Chat (pptx) no se pudo usar: JSON inválido')
  })

  it('el canal diag:problem acepta el origen «chat-doc» y rechaza cualquier otro', () => {
    const schema = IPC_SCHEMAS['diag:problem']
    expect(() => schema({ message: 'm', origin: 'chat-doc' })).not.toThrow()
    expect(() => schema({ message: 'm' })).not.toThrow()
    expect(() => schema({ message: 'm', origin: 'main' } as never)).toThrow()
  })
})
