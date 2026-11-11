import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const location = vi.hoisted(() => ({ root: '' }))
vi.mock('electron', () => ({ app: { getPath: () => location.root } }))
import { NetworkPolicy } from './proxy-policy'

describe('red interna por sitio', () => {
  beforeEach(() => {
    location.root = mkdtempSync(join(tmpdir(), 'lzx-red-'))
  })
  afterEach(() => {
    rmSync(location.root, { recursive: true, force: true })
  })
  it('migra entradas antiguas sin excepciones ni puertos', () => {
    writeFileSync(join(location.root, 'tasks-network.json'), JSON.stringify({ custom: ['a.test'], blocked: [] }))
    const p = new NetworkPolicy()
    expect(p.state().exceptions).toEqual([])
    expect(p.optionsFor('a.test')).toBeUndefined()
  })
  it('guarda por entrada exacta y conserva la excepción al recargar', () => {
    const p = new NetworkPolicy()
    p.setException({ host: 'intranet.local', internal: true, ports: [8443, 8443] })
    p.setHostAlways('otra.test', 'allow')
    expect(p.optionsFor('intranet.local')).toEqual({ host: 'intranet.local', internal: true, ports: [8443] })
    expect(p.optionsFor('sub.intranet.local')).toBeUndefined()
    expect(p.optionsFor('otra.test')).toBeUndefined()
    expect(new NetworkPolicy().optionsFor('intranet.local')?.ports).toEqual([8443])
    expect(JSON.parse(readFileSync(join(location.root, 'tasks-network.json'), 'utf8')).exceptions).toHaveLength(1)
    p.setHostAlways('intranet.local', 'unset')
    expect(p.optionsFor('intranet.local')).toBeUndefined()
    p.setHostAlways('intranet.local', 'allow')
    expect(p.optionsFor('intranet.local')).toBeUndefined()
  })
  it('sin marca no se puede añadir un host por el canal de opciones', () => {
    expect(() => new NetworkPolicy().setException({ host: 'nuevo.test', internal: false, ports: [8443] })).toThrow()
  })
})
