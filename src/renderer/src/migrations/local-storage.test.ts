import { describe, expect, it } from 'vitest'
import { LS_SCHEMA_KEY, migrateLocalStorage, type StorageLike } from './local-storage'

class MemoryStorage implements StorageLike {
  private m = new Map<string, string>()
  constructor(init: Record<string, string> = {}) {
    for (const [k, v] of Object.entries(init)) this.m.set(k, v)
  }
  get length(): number {
    return this.m.size
  }
  key(i: number): string | null {
    return [...this.m.keys()][i] ?? null
  }
  getItem(k: string): string | null {
    return this.m.has(k) ? (this.m.get(k) as string) : null
  }
  setItem(k: string, v: string): void {
    this.m.set(k, v)
  }
  dump(): Record<string, string> {
    return Object.fromEntries(this.m)
  }
}

describe('migrateLocalStorage', () => {
  it('copia cowork.* a tasks.*, convierte los valores de modo y escribe el marcador', () => {
    const s = new MemoryStorage({
      'cowork.pinned': '["a"]',
      'cowork.lastFolder': '/x',
      'cowork.sidebarGroupMode': 'date',
      'ui.mode': 'cowork',
      'settings.section': 'cowork',
      'onyx.lru.max': '5'
    })
    const r = migrateLocalStorage(s)
    expect(r.skipped).toBe(false)
    expect(r.copied.sort()).toEqual(['tasks.lastFolder', 'tasks.pinned', 'tasks.sidebarGroupMode'])
    expect(r.converted.sort()).toEqual(['settings.section', 'ui.mode'])
    const d = s.dump()
    expect(d['tasks.pinned']).toBe('["a"]')
    expect(d['ui.mode']).toBe('tasks')
    expect(d['settings.section']).toBe('tasks')
    expect(d['onyx.lru.max']).toBe('5')
    expect(d[LS_SCHEMA_KEY]).toBe('1')
    // las viejas se conservan (copia, no movimiento)
    expect(d['cowork.pinned']).toBe('["a"]')
  })

  it('no pisa una clave nueva que ya existe', () => {
    const s = new MemoryStorage({ 'cowork.lastFolder': '/viejo', 'tasks.lastFolder': '/nuevo' })
    const r = migrateLocalStorage(s)
    expect(r.copied).toEqual([])
    expect(s.getItem('tasks.lastFolder')).toBe('/nuevo')
  })

  it('no toca otros valores de ui.mode y es idempotente (marcador)', () => {
    const s = new MemoryStorage({ 'ui.mode': 'code', 'cowork.pinned': '[]' })
    migrateLocalStorage(s)
    expect(s.getItem('ui.mode')).toBe('code')
    s.setItem('cowork.panelOpen', '1')
    const again = migrateLocalStorage(s)
    expect(again.skipped).toBe(true)
    expect(s.getItem('tasks.panelOpen')).toBeNull()
  })

  it('con storage vacío solo escribe el marcador', () => {
    const s = new MemoryStorage()
    const r = migrateLocalStorage(s)
    expect(r.copied).toEqual([])
    expect(s.dump()).toEqual({ [LS_SCHEMA_KEY]: '1' })
  })
})
