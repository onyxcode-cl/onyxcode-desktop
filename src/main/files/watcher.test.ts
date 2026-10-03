import { EventEmitter } from 'node:events'
import { mkdirSync, mkdtempSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FilesChangedEvent } from '@shared/ipc-code'
import { changedDirFor, createCoalescer, FileWatchHub, normalizeWatchDir, watchModeFor } from './watcher'

describe('changedDirFor / normalizeWatchDir', () => {
  it('devuelve la carpeta padre del evento', () => {
    expect(changedDirFor('a.txt')).toBe('.')
    expect(changedDirFor('src/app/x.ts')).toBe('src/app')
    expect(changedDirFor('src\\app\\x.ts')).toBe('src/app')
  })
  it('ignora lo que cuelga de .git, node_modules y carpetas de build', () => {
    for (const p of [
      '.git/index',
      '.git/refs/heads/x',
      'node_modules/a/b.js',
      'src/dist/x.js',
      'a/.venv/lib/x.py',
      'target/debug/x',
      '__pycache__/m.pyc'
    ])
      expect(changedDirFor(p), p).toBeNull()
  })
  it('pero la aparición de la carpeta ignorada sí cambia a su padre', () => {
    expect(changedDirFor('node_modules')).toBe('.')
    expect(changedDirFor('pkg/dist')).toBe('pkg')
  })
  it('rechaza vacíos, nulos y `..`', () => {
    for (const p of [null, undefined, '', '..', 'a/../b']) expect(changedDirFor(p as string)).toBeNull()
  })
  it('normalizeWatchDir: relativas válidas y no ignoradas', () => {
    expect(normalizeWatchDir('.')).toBe('.')
    expect(normalizeWatchDir('src/a')).toBe('src/a')
    for (const p of ['/etc', 'C:\\x', '../x', 'a/../..', 'node_modules/x', '.git', 5, 'a\0b'])
      expect(normalizeWatchDir(p), String(p)).toBeNull()
  })
  it('modo por plataforma', () => {
    expect(watchModeFor('darwin')).toBe('recursive')
    expect(watchModeFor('win32')).toBe('recursive')
    expect(watchModeFor('linux')).toBe('dirs')
  })
})

describe('createCoalescer', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())
  it('agrupa ráfagas en un solo aviso y deduplica carpetas', () => {
    const flush = vi.fn()
    const c = createCoalescer(flush, { delayMs: 200, maxWaitMs: 1000 })
    c.add('a')
    vi.advanceTimersByTime(100)
    c.add('a')
    c.add('b')
    vi.advanceTimersByTime(199)
    expect(flush).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(flush).toHaveBeenCalledTimes(1)
    expect(flush.mock.calls[0][0].sort()).toEqual(['a', 'b'])
    expect(c.pending()).toBe(false)
  })
  it('una ráfaga continua se corta en maxWait', () => {
    const flush = vi.fn()
    const c = createCoalescer(flush, { delayMs: 200, maxWaitMs: 1000 })
    for (let i = 0; i < 20; i++) {
      c.add('x')
      vi.advanceTimersByTime(100)
    }
    expect(flush.mock.calls.length).toBeGreaterThanOrEqual(1)
    expect(flush.mock.calls.length).toBeLessThanOrEqual(3)
  })
  it('demasiadas carpetas o null = refrescar todo', () => {
    const flush = vi.fn()
    const c = createCoalescer(flush, { maxDirs: 3 })
    for (const d of ['a', 'b', 'c', 'd']) c.add(d)
    vi.advanceTimersByTime(300)
    expect(flush).toHaveBeenLastCalledWith(null)
    c.add(null)
    vi.advanceTimersByTime(300)
    expect(flush).toHaveBeenLastCalledWith(null)
  })
  it('cancel no avisa', () => {
    const flush = vi.fn()
    const c = createCoalescer(flush)
    c.add('a')
    c.cancel()
    vi.advanceTimersByTime(5000)
    expect(flush).not.toHaveBeenCalled()
  })
})

class FakeWatcher extends EventEmitter {
  closed = false
  constructor(
    readonly path: string,
    readonly opts: { recursive?: boolean },
    readonly cb: (evt: string, name: string | null) => void
  ) {
    super()
  }
  close(): void {
    this.closed = true
  }
}

describe('FileWatchHub', () => {
  let root: string
  let made: FakeWatcher[]
  let events: Array<[number, FilesChangedEvent]>
  const mk = (platform: string, extra: Partial<ConstructorParameters<typeof FileWatchHub>[1]> = {}): FileWatchHub =>
    new FileWatchHub((wc, ev) => events.push([wc, ev]), {
      platform,
      delayMs: 200,
      watch: ((p: string, o: { recursive?: boolean }, cb: (e: string, n: string | null) => void) => {
        const w = new FakeWatcher(p, o, cb)
        made.push(w)
        return w
      }) as never,
      ...extra
    })
  beforeEach(() => {
    vi.useFakeTimers()
    made = []
    events = []
    root = realpathSync(mkdtempSync(join(tmpdir(), 'onyx-watch-')))
    mkdirSync(join(root, 'src'))
  })
  afterEach(() => vi.useRealTimers())

  it('mac/win: un vigilante recursivo; coalesce, filtra ignorados y avisa por suscripción', () => {
    const hub = mk('darwin', { exists: () => true })
    expect(hub.subscribe(1, root, 'sub-aaaaaaaa')).toEqual({ mode: 'recursive' })
    expect(made).toHaveLength(1)
    expect(made[0].opts.recursive).toBe(true)
    made[0].cb('rename', 'src/a.ts')
    made[0].cb('change', 'src/b.ts')
    made[0].cb('change', 'node_modules/x/y.js')
    made[0].cb('change', '.git/index')
    expect(events).toHaveLength(0)
    vi.advanceTimersByTime(200)
    expect(events).toEqual([[1, { subId: 'sub-aaaaaaaa', dirs: ['src'], status: 'ok' }]])
    hub.closeAll()
  })
  it('solo ignorados: no hay aviso', () => {
    const hub = mk('win32', { exists: () => true })
    hub.subscribe(1, root, 'sub-aaaaaaaa')
    made[0].cb('change', '.git/HEAD')
    vi.advanceTimersByTime(1000)
    expect(events).toHaveLength(0)
  })
  it('dos suscripciones a la misma carpeta comparten vigilante; se cierra al soltar la última', () => {
    const hub = mk('darwin', { exists: () => true })
    hub.subscribe(1, root, 'sub-aaaaaaaa')
    hub.subscribe(1, root, 'sub-bbbbbbbb')
    expect(made).toHaveLength(1)
    hub.unsubscribe(1, 'sub-aaaaaaaa')
    expect(made[0].closed).toBe(false)
    hub.unsubscribe(1, 'sub-bbbbbbbb')
    expect(made[0].closed).toBe(true)
    expect(hub.isActive(1, root)).toBe(false)
  })
  it('releaseSender suelta todo de esa ventana y nada más', () => {
    const hub = mk('darwin', { exists: () => true })
    hub.subscribe(1, root, 'sub-aaaaaaaa')
    hub.subscribe(2, root, 'sub-bbbbbbbb')
    hub.releaseSender(1)
    expect(hub.isActive(1, root)).toBe(false)
    expect(hub.isActive(2, root)).toBe(true)
    expect(made[0].closed).toBe(false)
  })
  it('isActive solo para la ventana/carpeta suscrita', () => {
    const hub = mk('darwin', { exists: () => true })
    hub.subscribe(1, root, 'sub-aaaaaaaa')
    expect(hub.isActive(1, root)).toBe(true)
    expect(hub.isActive(2, root)).toBe(false)
    expect(hub.isActive(1, join(root, 'src'))).toBe(false)
  })
  it('tope de vigilantes recursivos: el excedente queda en modo none (manual)', () => {
    const hub = mk('darwin', { maxRecursive: 1, exists: () => true })
    const other = realpathSync(mkdtempSync(join(tmpdir(), 'onyx-watch2-')))
    expect(hub.subscribe(1, root, 'sub-aaaaaaaa').mode).toBe('recursive')
    expect(hub.subscribe(1, other, 'sub-bbbbbbbb').mode).toBe('none')
    expect(made).toHaveLength(1)
    expect(hub.isActive(1, other)).toBe(true) // sigue siendo el proyecto activo para el gestor
  })
  it('error del vigilante (ENOSPC): se libera y se avisa como perdido, sin lanzar', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const hub = mk('darwin', { exists: () => true })
    hub.subscribe(1, root, 'sub-aaaaaaaa')
    made[0].emit('error', Object.assign(new Error('x'), { code: 'ENOSPC' }))
    expect(made[0].closed).toBe(true)
    expect(events).toEqual([[1, { subId: 'sub-aaaaaaaa', dirs: null, status: 'lost' }]])
    warn.mockRestore()
  })
  it('fs.watch que lanza (EMFILE) en la creación: modo none y aviso', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const hub = new FileWatchHub((wc, ev) => events.push([wc, ev]), {
      platform: 'darwin',
      watch: (() => {
        throw Object.assign(new Error('boom'), { code: 'EMFILE' })
      }) as never
    })
    expect(() => hub.subscribe(1, root, 'sub-aaaaaaaa')).not.toThrow()
    expect(events[0][1].status).toBe('lost')
    warn.mockRestore()
  })
  it('carpeta borrada/desconectada al llegar el evento: perdida', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const hub = mk('darwin', { exists: () => false })
    hub.subscribe(1, root, 'sub-aaaaaaaa')
    made[0].cb('rename', 'src')
    vi.advanceTimersByTime(300)
    expect(events.map((e) => e[1].status)).toEqual(['lost'])
    expect(made[0].closed).toBe(true)
    warn.mockRestore()
  })
  it('carpeta inexistente al suscribir: none + lost, sin lanzar', () => {
    const hub = mk('darwin')
    expect(hub.subscribe(1, join(root, 'no-existe'), 'sub-aaaaaaaa')).toEqual({ mode: 'none' })
    vi.advanceTimersByTime(0)
    return Promise.resolve().then(() => expect(events[0][1].status).toBe('lost'))
  })
  it('Linux: solo carpetas abiertas (raíz siempre), con setDirs, ignorando ilegales, con tope', () => {
    const hub = mk('linux', { exists: () => true, maxDirWatchers: 2 })
    expect(hub.subscribe(1, root, 'sub-aaaaaaaa')).toEqual({ mode: 'dirs' })
    expect(made.map((w) => w.path)).toEqual([root])
    expect(made[0].opts.recursive).toBeUndefined()
    hub.setDirs(1, 'sub-aaaaaaaa', ['src', '../fuera', 'node_modules/x', '/etc'])
    expect(made.map((w) => w.path)).toEqual([root, join(root, 'src')])
    made[1].cb('rename', 'nuevo.ts')
    vi.advanceTimersByTime(200)
    expect(events[0][1].dirs).toEqual(['src'])
    hub.setDirs(1, 'sub-aaaaaaaa', [])
    expect(made[1].closed).toBe(true)
    expect(hub.watcherCount()).toBe(1)
    mkdirSync(join(root, 'a'))
    mkdirSync(join(root, 'b'))
    hub.setDirs(1, 'sub-aaaaaaaa', ['a', 'b'])
    expect(hub.watcherCount()).toBe(2) // tope 2: la raíz + una
  })
  it('setDirs de otra ventana o de una suscripción desconocida se ignora', () => {
    const hub = mk('linux', { exists: () => true })
    hub.subscribe(1, root, 'sub-aaaaaaaa')
    hub.setDirs(2, 'sub-aaaaaaaa', ['src'])
    hub.setDirs(1, 'sub-zzzzzzzz', ['src'])
    expect(hub.watcherCount()).toBe(1)
  })
})
