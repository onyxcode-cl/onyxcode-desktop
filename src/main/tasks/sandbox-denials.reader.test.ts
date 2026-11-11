import { describe, expect, it, vi } from 'vitest'
const mock = vi.hoisted(() => ({ spawn: vi.fn() }))
vi.mock('node:child_process', () => ({ spawn: mock.spawn }))
import { readSandboxLog } from './sandbox-denials'

describe('lector del registro del sistema', () => {
  it('ejecuta log sin shell, sin historial y filtrando solo la etiqueta del lanzamiento', () => {
    const tag = 'lzx-denial-' + '1'.repeat(32)
    readSandboxLog(tag)
    expect(mock.spawn).toHaveBeenCalledWith(
      '/usr/bin/log',
      ['stream', '--style', 'ndjson', '--predicate', `eventMessage ENDSWITH "${tag}"`],
      { stdio: ['ignore', 'pipe', 'pipe'] }
    )
  })
  it('rechaza inyectar expresiones en el predicado', () => {
    expect(() => readSandboxLog('" OR true')).toThrow()
    expect(mock.spawn).toHaveBeenCalledTimes(1)
  })
})
