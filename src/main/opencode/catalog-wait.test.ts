import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { catalogFile, waitForCatalog } from './catalog-wait'

const dirs: string[] = []
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})
const tmp = (): string => {
  const d = mkdtempSync(join(tmpdir(), 'lzx-catalog-'))
  dirs.push(d)
  return d
}

describe('catalogFile', () => {
  it('usa XDG_CACHE_HOME, o HOME/.cache, o OPENCODE_MODELS_PATH', () => {
    expect(catalogFile({ XDG_CACHE_HOME: '/c' })).toBe(join('/c', 'opencode', 'models.json'))
    expect(catalogFile({ HOME: '/h' })).toBe(join('/h', '.cache', 'opencode', 'models.json'))
    expect(catalogFile({ HOME: '/h', XDG_CACHE_HOME: '/c', OPENCODE_MODELS_PATH: '/m.json' })).toBe('/m.json')
  })
})

describe('waitForCatalog', () => {
  it('si ya estaba no espera', async () => {
    const root = tmp()
    mkdirSync(join(root, 'opencode'))
    const f = catalogFile({ XDG_CACHE_HOME: root })
    writeFileSync(f, '{"a":1}')
    expect(await waitForCatalog(f, { sleep: () => Promise.reject(new Error('no debe dormir')) })).toBe('present')
  })

  it('un archivo vacío no cuenta como presente', async () => {
    const root = tmp()
    mkdirSync(join(root, 'opencode'))
    const f = catalogFile({ XDG_CACHE_HOME: root })
    writeFileSync(f, '')
    expect(await waitForCatalog(f, { timeoutMs: 20, intervalMs: 5, sleep: () => new Promise((r) => setTimeout(r, 5)) })).toBe('timeout')
  })

  it('espera a que aparezca y lo avisa', async () => {
    const root = tmp()
    const f = catalogFile({ XDG_CACHE_HOME: root })
    let n = 0
    const exists = (): boolean => n >= 3
    const sleep = async (): Promise<void> => {
      n++
    }
    expect(await waitForCatalog(f, { exists, sleep, timeoutMs: 10_000 })).toBe('appeared')
    expect(n).toBeGreaterThanOrEqual(3)
  })

  it('sin red (nunca aparece) vence el tope y sigue adelante', async () => {
    let t = 0
    const r = await waitForCatalog('/no/existe/models.json', {
      timeoutMs: 6000,
      intervalMs: 100,
      now: () => t,
      sleep: async (ms) => {
        t += ms
      }
    })
    expect(r).toBe('timeout')
    expect(t).toBeGreaterThanOrEqual(6000)
  })
})
