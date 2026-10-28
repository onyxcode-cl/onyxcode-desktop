/**
 * Backend de macOS del MCP de Control del Mac, con `execFile` y el sistema de archivos simulados: fija los comandos EXACTOS
 * (binario, argumentos, banderas) de las ramas que `mcp-server.equivalence.test.ts` no puede recorrer sin tocar la pantalla real
 * (ScreenCaptureKit, `screencapture`, enmascarado, `sips`, Spotlight). Los literales son los del código de antes de abstraer.
 * No ejecuta ningún binario del sistema.
 */
import { EventEmitter } from 'node:events'
import { isWin } from '../../test/platform'
import { describe, expect, it, vi } from 'vitest'
import type { PlatformHost } from './mcp-platform'
import { createDarwinBackend, type DarwinDeps } from './mcp-platform-darwin'

type Reply = { stdout?: string; stderr?: string; code?: number; delayMs?: number }
interface Call {
  cmd: string
  args: string[]
}

function rig(
  reply: (cmd: string, args: string[]) => Reply,
  cfg: Partial<PlatformHost['config']> = {},
  tiers: Record<string, 'view' | 'click' | 'full' | null> = {},
  files: Set<string> = new Set(['/h/cu-helper']),
  sideGet: PlatformHost['sideGet'] = async () => ({}),
  lstat: DarwinDeps['lstatSync'] = () => ({ isFile: () => true, isSymbolicLink: () => false, size: 100 })
): { backend: ReturnType<typeof createDarwinBackend>; calls: Call[]; kills: Array<{ pid: number; sig: string }>; logs: string[] } {
  const calls: Call[] = []
  const kills: Array<{ pid: number; sig: string }> = []
  const logs: string[] = []
  let pid = 10
  const execFile = ((cmd: string, args: string[], _o: unknown, cb: (e: unknown, so: string, se: string) => void) => {
    calls.push({ cmd, args })
    const r = reply(cmd, args)
    const child = Object.assign(new EventEmitter(), {
      pid: ++pid,
      exitCode: null as number | null,
      signalCode: null as string | null,
      kill: (sig: string) => void kills.push({ pid: child.pid, sig })
    })
    const later = r.delayMs ? (f: () => void) => void setTimeout(f, r.delayMs) : queueMicrotask
    later(() => {
      if (r.code) cb(Object.assign(new Error('fallo'), { code: r.code }), r.stdout ?? '', r.stderr ?? '')
      else cb(null, r.stdout ?? '', r.stderr ?? '')
    })
    return child
  }) as never
  const host: PlatformHost = {
    config: {
      helper: '/h/cu-helper',
      eventsUrl: 'http://127.0.0.1:1',
      instant: false,
      typeDelay: '',
      maxLong: 1366,
      shotDir: '/s',
      fakeShot: '',
      neverExclude: new Set(['com.apple.finder']),
      ...cfg
    },
    log: (...a) => void logs.push(a.map(String).join(' ')),
    tierOf: async (app) => tiers[app.bundleId] ?? null,
    mainScreen: async () => ({ width: 1440, height: 900, scale: 2, main: true }),
    sideGet
  }
  const backend = createDarwinBackend(host, {
    execFile,
    existsSync: (p) => files.has(p),
    readdirSync: () => {
      throw new Error('sin carpeta')
    },
    lstatSync: lstat,
    homedir: () => '/Users/x'
  })
  return { backend, calls, kills, logs }
}

const SIPS_RESIZE = (raw: string, out: string): string[] => [
  '-Z',
  '1366',
  '-s',
  'format',
  'jpeg',
  '-s',
  'formatOptions',
  '70',
  raw,
  '--out',
  out
]
const DIMS = 'pixelWidth: 1366\n  pixelHeight: 853\n'

describe('macOS: capturas (comandos exactos)', () => {
  it('captura falsa de pruebas: cp + sips (redimensiona y mide)', async () => {
    const { backend, calls } = rig((cmd) => (cmd === '/usr/bin/sips' ? { stdout: DIMS } : {}), { fakeShot: '/fake.png' })
    expect(await backend.captureScreen({ raw: '/s/r.png', out: '/s/o.jpg' })).toEqual({ width: 1366, height: 853 })
    expect(calls).toEqual([
      { cmd: '/bin/cp', args: ['/fake.png', '/s/r.png'] },
      { cmd: '/usr/bin/sips', args: SIPS_RESIZE('/s/r.png', '/s/o.jpg') },
      { cmd: '/usr/bin/sips', args: ['-g', 'pixelWidth', '-g', 'pixelHeight', '/s/o.jpg'] }
    ])
  })

  it('sin apps que excluir: screencapture -x -C -m -t png y sips', async () => {
    const { backend, calls } = rig(
      (cmd, args) => (cmd === '/usr/bin/sips' ? { stdout: DIMS } : args[0] === 'running-apps' ? { stdout: '[]' } : {}),
      {},
      {},
      new Set(['/h/cu-helper', '/s/r.png'])
    )
    await backend.captureScreen({ raw: '/s/r.png', out: '/s/o.jpg' })
    expect(calls.map((c) => [c.cmd, ...c.args])).toEqual([
      ['/h/cu-helper', 'running-apps'],
      ['/usr/sbin/screencapture', '-x', '-C', '-m', '-t', 'png', '/s/r.png'],
      ['/usr/bin/sips', ...SIPS_RESIZE('/s/r.png', '/s/o.jpg')],
      ['/usr/bin/sips', '-g', 'pixelWidth', '-g', 'pixelHeight', '/s/o.jpg']
    ])
  })

  it('apps sin concesión (y sin las exentas): ScreenCaptureKit las excluye por bundle id', async () => {
    const running = JSON.stringify([
      { bundleId: 'com.a.Concedida', name: 'A' },
      { bundleId: 'com.b.Sin', name: 'B' },
      { bundleId: 'com.c.Sin', name: 'C' },
      { bundleId: 'com.apple.finder', name: 'Finder' }
    ])
    const { backend, calls } = rig(
      (cmd, args) => (cmd === '/usr/bin/sips' ? { stdout: DIMS } : args.includes('running-apps') ? { stdout: running } : {}),
      { instant: true, typeDelay: '9' },
      { 'com.a.Concedida': 'view' }
    )
    await backend.captureScreen({ raw: '/s/r.png', out: '/s/o.jpg' })
    expect(calls[1]).toEqual({
      cmd: '/h/cu-helper',
      args: ['--instant', '--char-delay', '9', 'screenshot-sck', '/s/r.png', 'com.b.Sin,com.c.Sin']
    })
    expect(calls.some((c) => c.cmd === '/usr/sbin/screencapture')).toBe(false)
  })

  it('con sesión, "visible" = app de la TAREA ACTUAL (F8-B149): una app con concesión de siempre pero fuera de la tarea de hoy se excluye igual', async () => {
    const running = JSON.stringify([
      { bundleId: 'com.a.ConcedidaHaceTiempo', name: 'A' }, // tier 'view' persistido, pero NO en taskApps
      { bundleId: 'com.b.DeEstaTarea', name: 'B' }, // en taskApps
      { bundleId: 'com.apple.finder', name: 'Finder' }
    ])
    const { backend, calls } = rig(
      (cmd, args) => (cmd === '/usr/bin/sips' ? { stdout: DIMS } : args.includes('running-apps') ? { stdout: running } : {}),
      {},
      { 'com.a.ConcedidaHaceTiempo': 'view', 'com.b.DeEstaTarea': 'view' },
      undefined,
      async (path) => (path.startsWith('/task-apps') ? { apps: ['com.b.DeEstaTarea'] } : {})
    )
    await backend.captureScreen({ raw: '/s/r.png', out: '/s/o.jpg', session: 'ses_x' })
    expect(calls[1]).toEqual({ cmd: '/h/cu-helper', args: ['screenshot-sck', '/s/r.png', 'com.a.ConcedidaHaceTiempo'] })
  })

  it('sin sesión, sigue el criterio viejo (cualquier concesión) — no hay "tarea actual" que consultar', async () => {
    const running = JSON.stringify([
      { bundleId: 'com.a.Concedida', name: 'A' },
      { bundleId: 'com.b.Sin', name: 'B' }
    ])
    const { backend, calls } = rig(
      (cmd, args) => (cmd === '/usr/bin/sips' ? { stdout: DIMS } : args.includes('running-apps') ? { stdout: running } : {}),
      {},
      { 'com.a.Concedida': 'view' }
    )
    await backend.captureScreen({ raw: '/s/r.png', out: '/s/o.jpg' })
    expect(calls[1]).toEqual({ cmd: '/h/cu-helper', args: ['screenshot-sck', '/s/r.png', 'com.b.Sin'] })
  })

  it('H6: origen aislado ⇒ además se tapan las apps exentas de `isolatedMask` (Lazunox, Spotlight…); sin `isolated` no cambia nada', async () => {
    const running = JSON.stringify([
      { bundleId: 'cl.bentec.lazunox', name: 'Lazunox' },
      { bundleId: 'com.apple.Spotlight', name: 'Spotlight' },
      { bundleId: 'com.apple.dock', name: 'Dock' },
      { bundleId: 'com.apple.finder', name: 'Finder' },
      { bundleId: 'com.a.DeEstaTarea', name: 'A' }
    ])
    const cfg = {
      neverExclude: new Set(['cl.bentec.lazunox', 'com.apple.Spotlight', 'com.apple.dock', 'com.apple.finder']),
      isolatedMask: new Set(['cl.bentec.lazunox', 'com.apple.Spotlight'])
    }
    const reply = (cmd: string, args: string[]): Reply =>
      cmd === '/usr/bin/sips' ? { stdout: DIMS } : args.includes('running-apps') ? { stdout: running } : {}
    const side: PlatformHost['sideGet'] = async (path) => (path.startsWith('/task-apps') ? { apps: ['com.a.DeEstaTarea'] } : {})
    const iso = rig(reply, cfg, {}, undefined, side)
    await iso.backend.captureScreen({ raw: '/s/r.png', out: '/s/o.jpg', session: 'ses_x', isolated: true })
    expect(iso.calls[1]).toEqual({ cmd: '/h/cu-helper', args: ['screenshot-sck', '/s/r.png', 'cl.bentec.lazunox,com.apple.Spotlight'] })
    const normal = rig(reply, cfg, {}, new Set(['/h/cu-helper', '/s/r.png']), side)
    await normal.backend.captureScreen({ raw: '/s/r.png', out: '/s/o.jpg', session: 'ses_x' })
    // Sin origen aislado: ninguna exenta se excluye (no hay nada que excluir ⇒ captura normal, sin screenshot-sck).
    expect(normal.calls.some((c) => c.args.includes('screenshot-sck'))).toBe(false)
  })

  it('F3: origen aislado FALLA CERRADO: si running-apps falla no hay captura (sin él, mejor esfuerzo como siempre)', async () => {
    const reply = (cmd: string, args: string[]): Reply =>
      cmd === '/usr/bin/sips' ? { stdout: DIMS } : args.includes('running-apps') ? { code: 1, stderr: 'boom' } : {}
    const iso = rig(reply, {}, {}, new Set(['/h/cu-helper', '/s/r.png']))
    await expect(iso.backend.captureScreen({ raw: '/s/r.png', out: '/s/o.jpg', session: 'ses_x', isolated: true })).rejects.toThrow(
      /no se devuelve la pantalla/
    )
    expect(iso.calls.some((c) => c.args.includes('-x') || c.cmd === '/usr/bin/sips')).toBe(false)
    const normal = rig(reply, {}, {}, new Set(['/h/cu-helper', '/s/r.png']))
    await expect(normal.backend.captureScreen({ raw: '/s/r.png', out: '/s/o.jpg' })).resolves.toBeDefined()
  })

  it('F3: origen aislado, ScreenCaptureKit y el enmascarado de respaldo fallan ⇒ error, no se convierte la imagen', async () => {
    const reply = (cmd: string, args: string[]): Reply => {
      if (cmd === '/usr/bin/sips') return { stdout: DIMS }
      if (args[0] === 'running-apps') return { stdout: JSON.stringify([{ bundleId: 'com.b.Sin', name: 'B' }]) }
      if (args[0] === 'screenshot-sck') return { code: 4 }
      if (args[0] === 'windows-of') return { stdout: JSON.stringify([{ x: 1, y: 1, width: 2, height: 2 }]) }
      if (args[0] === 'mask-regions') return { code: 1, stderr: 'no pudo' }
      return {}
    }
    const files = new Set(['/h/cu-helper', '/s/r.png'])
    const iso = rig(reply, {}, {}, files)
    await expect(iso.backend.captureScreen({ raw: '/s/r.png', out: '/s/o.jpg', isolated: true })).rejects.toThrow(
      /no se devuelve la pantalla/
    )
    expect(iso.calls.some((c) => c.cmd === '/usr/bin/sips')).toBe(false)
    // Sin origen aislado: se registra y la captura sigue (como hoy).
    const normal = rig(reply, {}, {}, new Set(['/h/cu-helper', '/s/r.png']))
    await expect(normal.backend.captureScreen({ raw: '/s/r.png', out: '/s/o.jpg' })).resolves.toBeDefined()
  })

  it('pasa SIEMPRE el id de la pantalla elegida a screenshot-sck, también si es la principal', async () => {
    // Sin id el helper captura `displays.first` de SCK, que con un monitor vertical a la izquierda no es la
    // principal: la imagen salía sin ninguna ventana (solo el fondo) y con la escala de otra pantalla.
    const running = JSON.stringify([{ bundleId: 'com.b.Sin', name: 'B' }])
    const { backend, calls } = rig(
      (cmd, args) => (cmd === '/usr/bin/sips' ? { stdout: DIMS } : args.includes('running-apps') ? { stdout: running } : {}),
      {},
      {}
    )
    await backend.captureScreen({
      raw: '/s/r.png',
      out: '/s/o.jpg',
      screen: { width: 1920, height: 1080, scale: 1, x: 0, y: 0, main: true, displayID: 2 }
    })
    expect(calls[1]).toEqual({ cmd: '/h/cu-helper', args: ['screenshot-sck', '/s/r.png', 'com.b.Sin', '2'] })
  })

  it('ScreenCaptureKit falla: screencapture + windows-of + mask-regions con los rectángulos en píxeles (× escala)', async () => {
    const { backend, calls, logs } = rig(
      (cmd, args) => {
        if (cmd === '/usr/bin/sips') return { stdout: DIMS }
        if (args[0] === 'running-apps') return { stdout: JSON.stringify([{ bundleId: 'com.b.Sin', name: 'B' }]) }
        if (args[0] === 'screenshot-sck') return { code: 4, stderr: 'sck' }
        if (args[0] === 'windows-of')
          return {
            stdout: JSON.stringify([
              { x: 10, y: 20, width: 300, height: 200 },
              { x: 0, y: 0, width: 5, height: 5 }
            ])
          }
        return {}
      },
      {},
      {},
      new Set(['/h/cu-helper', '/s/r.png'])
    )
    await backend.captureScreen({ raw: '/s/r.png', out: '/s/o.jpg' })
    expect(calls.map((c) => c.args[0] ?? c.cmd)).toEqual(['running-apps', 'screenshot-sck', '-x', 'windows-of', 'mask-regions', '-Z', '-g'])
    expect(calls[3]).toEqual({ cmd: '/h/cu-helper', args: ['windows-of', 'com.b.Sin'] })
    expect(calls[4]).toEqual({ cmd: '/h/cu-helper', args: ['mask-regions', '/s/r.png', '/s/r.png', '20,40,600,400', '0,0,10,10'] })
    expect(logs.join('\n')).toMatch(/ScreenCaptureKit no disponible, uso screencapture \+ enmascarado/)
  })

  it('si no hay ventanas de esas apps, no se llama a mask-regions', async () => {
    const { backend, calls } = rig(
      (cmd, args) => {
        if (cmd === '/usr/bin/sips') return { stdout: DIMS }
        if (args[0] === 'running-apps') return { stdout: JSON.stringify([{ bundleId: 'com.b.Sin', name: 'B' }]) }
        if (args[0] === 'screenshot-sck') return { code: 5 }
        if (args[0] === 'windows-of') return { stdout: '[]' }
        return {}
      },
      {},
      {},
      new Set(['/h/cu-helper', '/s/r.png'])
    )
    await backend.captureScreen({ raw: '/s/r.png', out: '/s/o.jpg' })
    expect(calls.some((c) => c.args[0] === 'mask-regions')).toBe(false)
  })

  it('un fallo del enmascarado se registra y la captura sigue (mejor esfuerzo, como siempre en macOS)', async () => {
    const { backend, logs } = rig(
      (cmd, args) => {
        if (cmd === '/usr/bin/sips') return { stdout: DIMS }
        if (args[0] === 'running-apps') return { stdout: JSON.stringify([{ bundleId: 'com.b.Sin', name: 'B' }]) }
        if (args[0] === 'screenshot-sck') return { code: 4 }
        if (args[0] === 'windows-of') return { code: 1, stderr: 'boom' }
        return {}
      },
      {},
      {},
      new Set(['/h/cu-helper', '/s/r.png'])
    )
    await expect(backend.captureScreen({ raw: '/s/r.png', out: '/s/o.jpg' })).resolves.toEqual({ width: 1366, height: 853 })
    expect(logs.join('\n')).toMatch(/enmascarado de apps no concedidas: boom/)
  })

  it('sin canal lateral o con running-apps roto no se excluye nada (mejor esfuerzo)', async () => {
    const a = rig((cmd) => (cmd === '/usr/bin/sips' ? { stdout: DIMS } : {}), { eventsUrl: '' }, {}, new Set(['/h/cu-helper', '/s/r.png']))
    await a.backend.captureScreen({ raw: '/s/r.png', out: '/s/o.jpg' })
    expect(a.calls[0].cmd).toBe('/usr/sbin/screencapture')
    const b = rig(
      (cmd, args) => (cmd === '/usr/bin/sips' ? { stdout: DIMS } : args[0] === 'running-apps' ? { code: 1, stderr: 'x' } : {}),
      {},
      {},
      new Set(['/h/cu-helper', '/s/r.png'])
    )
    await b.backend.captureScreen({ raw: '/s/r.png', out: '/s/o.jpg' })
    expect(b.calls.map((c) => c.args[0] ?? c.cmd)).toEqual(['running-apps', '-x', '-Z', '-g'])
  })

  it('screencapture falla: el mensaje pide el permiso de Grabación de pantalla', async () => {
    const { backend } = rig((cmd) => (cmd === '/usr/sbin/screencapture' ? { code: 1, stderr: 'denegado' } : { stdout: '[]' }), {
      eventsUrl: ''
    })
    await expect(backend.captureScreen({ raw: '/s/r.png', out: '/s/o.jpg' })).rejects.toThrow(
      'No se pudo capturar la pantalla (denegado). Falta el permiso de Grabación de pantalla para Lazunox (aparece como Lazunox en Ajustes del Sistema).'
    )
  })

  it('screencapture «funciona» pero no deja archivo', async () => {
    const { backend } = rig(() => ({}), { eventsUrl: '' })
    await expect(backend.captureScreen({ raw: '/s/r.png', out: '/s/o.jpg' })).rejects.toThrow(
      'No se pudo capturar la pantalla (¿permiso de Grabación de pantalla?)'
    )
  })

  it('captura de ventana: window-shot con el PNG intermedio y luego sips; los códigos se traducen', async () => {
    const ok = rig((cmd, args) =>
      cmd === '/usr/bin/sips' ? {} : args[0] === 'window-shot' ? { stdout: '{"width":800,"height":600,"title":"T"}' } : {}
    )
    expect(await ok.backend.windowShot('com.a.A', '/s/raw.png', '/s/o.jpg', 2)).toEqual({ width: 800, height: 600, title: 'T' })
    expect(ok.calls).toEqual([
      { cmd: '/h/cu-helper', args: ['window-shot', 'com.a.A', '/s/raw.png', '2'] },
      { cmd: '/usr/bin/sips', args: SIPS_RESIZE('/s/raw.png', '/s/o.jpg') }
    ])
    const bad = rig(() => ({ code: 5 }))
    await expect(bad.backend.windowShot('com.a.A', 'r', 'o', 0)).rejects.toThrow('window-shot falló (código 5)')
    expect(bad.calls.length).toBe(1) // sin sips
  })
})

describe('macOS: helper, parada y apps', () => {
  it('banderas globales y tiempo de 30 s; falta del helper', async () => {
    const { backend, calls } = rig(() => ({ stdout: '{}' }), { instant: true, typeDelay: '12' })
    await backend.helper('cursor')
    expect(calls[0]).toEqual({ cmd: '/h/cu-helper', args: ['--instant', '--char-delay', '12', 'cursor'] })
    const none = rig(() => ({}), { helper: '/no/esta' })
    await expect(none.backend.helper('cursor')).rejects.toThrow('Helper nativo no encontrado (/no/esta)')
    await expect(none.backend.helperExit('cursor')).rejects.toThrow('Helper nativo no encontrado (/no/esta)')
    const empty = rig(() => ({}), { helper: '' })
    await expect(empty.backend.helper('cursor')).rejects.toThrow('Helper nativo no encontrado (CU_HELPER vacío)')
  })

  it('helperExit devuelve el código de salida; un fallo sin código rechaza con stderr', async () => {
    const r = rig((_c, args) => (args[0] === 'a' ? { code: 8, stdout: 'x' } : {}))
    expect(await r.backend.helperExit('a')).toEqual({ stdout: 'x', code: 8 })
    expect(await r.backend.helperExit('b')).toEqual({ stdout: '', code: 0 })
  })

  it('mensajes de los códigos de salida (macOS)', () => {
    const { backend } = rig(() => ({}))
    expect(backend.exitMessage(2)).toBe('Falta el permiso de Accesibilidad para Lazunox (aparece como Lazunox en Ajustes del Sistema).')
    expect(backend.exitMessage(11)).toBe('Esa acción no está permitida.')
    expect(backend.exitMessage(12)).toBe('Recurso no disponible.')
    expect(backend.exitMessage(99)).toBeNull()
  })

  it('parada: SIGTERM a cada helper en vuelo y SIGKILL a los 300 ms si sigue vivo', async () => {
    vi.useFakeTimers()
    try {
      const calls: Array<() => void> = []
      const kills: string[] = []
      const host: PlatformHost = {
        config: {
          helper: '/h/cu-helper',
          eventsUrl: '',
          instant: false,
          typeDelay: '',
          maxLong: 1366,
          shotDir: '',
          fakeShot: '',
          neverExclude: new Set()
        },
        log: () => undefined,
        tierOf: async () => null,
        mainScreen: async () => ({ width: 1, height: 1, scale: 1 }),
        sideGet: async () => ({})
      }
      const b = createDarwinBackend(host, {
        existsSync: () => true,
        execFile: ((_c: string, _a: string[], _o: unknown, cb: () => void) => {
          calls.push(cb)
          return Object.assign(new EventEmitter(), { exitCode: null, signalCode: null, kill: (s: string) => void kills.push(s) })
        }) as never
      })
      void b.helperExit('drag', '1', '2', '3', '4')
      b.killChildren()
      expect(kills).toEqual(['SIGTERM'])
      await vi.advanceTimersByTimeAsync(300)
      expect(kills).toEqual(['SIGTERM', 'SIGKILL'])
      expect(calls.length).toBe(1)
    } finally {
      vi.useRealTimers()
    }
  })

  // Compara rutas POSIX construidas con el `join` del sistema donde corre: en un equipo Windows salen con `\\` (el backend de macOS no se usa allí).
  it.skipIf(isWin)('resolver app: helper → bundle id (mdfind + plutil) → Spotlight por nombre → recorrido de carpetas', async () => {
    const r = rig((cmd, args) => {
      if (args[0] === 'resolve-app') return { stdout: '{"found":false}' }
      if (cmd === '/usr/bin/mdfind' && args[0] === "kMDItemCFBundleIdentifier == 'com.x.App'") return { stdout: '/Applications/X.app\n' }
      if (cmd === '/usr/bin/plutil') return { stdout: 'com.x.App\n' }
      return {}
    })
    expect(await r.backend.resolveApp('com.x.App')).toEqual({ bundleId: 'com.x.App', name: 'X', found: true })
    expect(r.calls.map((c) => [c.cmd, ...c.args])).toEqual([
      ['/h/cu-helper', 'resolve-app', 'com.x.App'],
      ['/usr/bin/mdfind', "kMDItemCFBundleIdentifier == 'com.x.App'"],
      ['/usr/bin/plutil', '-extract', 'CFBundleIdentifier', 'raw', '-o', '-', '/Applications/X.app/Contents/Info.plist']
    ])

    const sp = rig((cmd, args) => {
      if (args[0] === 'resolve-app') return { stdout: '{"found":false}' }
      if (cmd === '/usr/bin/mdfind') return { stdout: '/Applications/Música.app kMDItemDisplayName = Música\n' }
      if (cmd === '/usr/bin/plutil') return { stdout: 'com.apple.Music\n' }
      return {}
    })
    expect(await sp.backend.resolveApp('musica')).toEqual({ bundleId: 'com.apple.Music', name: 'Música', found: true })
    expect(sp.calls[1]).toEqual({
      cmd: '/usr/bin/mdfind',
      args: ['-attr', 'kMDItemDisplayName', "kMDItemContentType == 'com.apple.application-bundle'"]
    })

    const none = rig((_c, args) => (args[0] === 'resolve-app' ? { stdout: '{"found":false}' } : { code: 1 }))
    expect(await none.backend.resolveApp('Zzzz Nada')).toEqual({ bundleId: '', name: 'Zzzz Nada', found: false })
    expect(await none.backend.resolveApp('  ')).toEqual({ bundleId: '', name: '  ', found: false })
  })

  it('las puertas de Windows no existen en macOS: preflight y teclas pasan tal cual; apps no identificadas no bloquean', async () => {
    const { backend, calls } = rig(() => ({}))
    await backend.preflight({ tool: 'left_click', realInput: true })
    expect(await backend.checkKeys('cmd+shift+t')).toBe('cmd+shift+t')
    expect(backend.failClosedOnUnknownApp).toBe(false)
    expect(backend.parseApp({ name: '', bundleId: undefined })).toEqual({ bundleId: '', name: '' })
    expect(backend.parseApp({ bundleId: 'com.a.A' })).toEqual({ bundleId: 'com.a.A', name: 'com.a.A' })
    expect(backend.normalizeScreen({ width: 1, height: 2, scale: 2, extra: 1 } as never)).toEqual({
      width: 1,
      height: 2,
      scale: 2,
      extra: 1
    })
    expect(calls).toEqual([])
  })
})

describe.skipIf(isWin)('teclado por teclas físicas (cu-keys, clientes de escritorio remoto)', () => {
  it('typeKeys y pressKeys ejecutan cu-keys junto a cu-helper, con la distribución elegida', async () => {
    const { backend, calls } = rig(() => ({ stdout: '{"typed":3}' }), {}, {}, new Set(['/h/cu-helper', '/h/cu-keys']))
    await backend.typeKeys!('a|b')
    await backend.typeKeys!('a|b', 'us')
    await backend.pressKeys!('ctrl+alt+supr')
    await backend.pressKeys!('ctrl+v', 'us')
    expect(calls).toEqual([
      { cmd: '/h/cu-keys', args: ['type'] },
      { cmd: '/h/cu-keys', args: ['type', '--layout', 'us'] },
      { cmd: '/h/cu-keys', args: ['key', 'ctrl+alt+supr'] },
      { cmd: '/h/cu-keys', args: ['key', '--layout', 'us', 'ctrl+v'] }
    ])
  })

  it('pasteText: guarda el portapapeles, pega por cu-keys y lo restaura', async () => {
    const { backend, calls } = rig(
      (cmd) => (cmd === '/usr/bin/pbpaste' ? { stdout: 'previo' } : {}),
      {},
      {},
      new Set(['/h/cu-helper', '/h/cu-keys'])
    )
    const r = await backend.pasteText!('a|{b}', 'cmd+v')
    expect(r.restored).toBe(true)
    // La restauración se programa para más tarde (el cliente remoto tarda en sincronizar): al volver, solo pbpaste, pbcopy y cu-keys.
    expect(calls.map((c) => c.cmd)).toEqual(['/usr/bin/pbpaste', '/usr/bin/pbcopy', '/h/cu-keys'])
    expect(calls[2].args).toEqual(['key', 'cmd+v'])
  })

  it('pasteText con beforePress que lanza (origen aislado: el foco cambió): NO pulsa, restaura el portapapeles y relanza', async () => {
    const { backend, calls } = rig(
      (cmd) => (cmd === '/usr/bin/pbpaste' ? { stdout: 'previo' } : {}),
      {},
      {},
      new Set(['/h/cu-helper', '/h/cu-keys'])
    )
    await expect(
      backend.pasteText!('secreto', 'cmd+v', async () => {
        throw new Error('foco cambió')
      })
    ).rejects.toThrow('foco cambió')
    expect(calls.some((c) => c.cmd === '/h/cu-keys')).toBe(false)
    expect(calls.map((c) => c.cmd)).toEqual(['/usr/bin/pbpaste', '/usr/bin/pbcopy', '/usr/bin/pbcopy'])
  })

  it('pasteText con beforePress que no lanza: pega igual que siempre', async () => {
    const { backend, calls } = rig(() => ({ stdout: '' }), {}, {}, new Set(['/h/cu-helper', '/h/cu-keys']))
    const before = vi.fn(async () => undefined)
    await backend.pasteText!('x', 'cmd+v', before)
    expect(before).toHaveBeenCalledTimes(1)
    expect(calls.map((c) => c.cmd)).toEqual(['/usr/bin/pbpaste', '/usr/bin/pbcopy', '/h/cu-keys'])
  })

  it('pasteText: sin texto previo no vacía el portapapeles al final (podría ser una imagen)', async () => {
    const { backend, calls } = rig(() => ({ stdout: '' }), {}, {}, new Set(['/h/cu-helper', '/h/cu-keys']))
    const r = await backend.pasteText!('x', 'ctrl+v')
    expect(r.restored).toBe(false)
    expect(calls.map((c) => c.cmd)).toEqual(['/usr/bin/pbpaste', '/usr/bin/pbcopy', '/h/cu-keys'])
  })

  it('sin el binario cu-keys el backend no ofrece teclado remoto (todo sigue por cu-helper, como antes)', () => {
    const { backend } = rig(() => ({}))
    expect(backend.typeKeys).toBeUndefined()
    expect(backend.pressKeys).toBeUndefined()
    expect(backend.pasteText).toBeUndefined()
  })
})

describe('macOS: ubicar la ventana capturada (locateWindowShot / windowFrames)', () => {
  const win = (x: number, y: number, width: number, height: number): Record<string, number> => ({ x, y, width, height })
  /** Helper falso: `windows-of` con las ventanas dadas y sips que mide el JPEG final. */
  const mk = (wins: unknown, jpeg = 'pixelWidth: 1366\n  pixelHeight: 768\n') =>
    rig((cmd, args) => (cmd === '/usr/bin/sips' ? { stdout: jpeg } : args[0] === 'windows-of' ? { stdout: JSON.stringify(wins) } : {}))

  it('elige la ventana por área (de mayor a menor) e índice, y mide el JPEG real con sips', async () => {
    const { backend, calls } = mk([win(0, 0, 100, 100), win(10, 20, 1400, 800), win(5, 5, 300, 200)])
    // Índice 0 = la más grande (1400×800); el PNG intermedio mide frame × 2.
    const loc = await backend.locateWindowShot('com.a.A', 0, { width: 2800, height: 1600 }, '/s/o.jpg')
    expect(loc).toEqual({
      rect: { x: 10, y: 20, width: 1400, height: 800 },
      frame: { x: 10, y: 20, width: 1400, height: 800 },
      imageWidth: 1366,
      imageHeight: 768
    })
    expect(calls).toEqual([
      { cmd: '/h/cu-helper', args: ['windows-of', 'com.a.A'] },
      { cmd: '/usr/bin/sips', args: ['-g', 'pixelWidth', '-g', 'pixelHeight', '/s/o.jpg'] }
    ])
    // Índice 1 = la mediana (300×200).
    const second = await mk([win(0, 0, 100, 100), win(10, 20, 1400, 800), win(5, 5, 300, 200)]).backend.locateWindowShot(
      'com.a.A',
      1,
      { width: 600, height: 400 },
      '/s/o.jpg'
    )
    expect(second?.frame).toEqual({ x: 5, y: 5, width: 300, height: 200 })
  })

  it('ventana con origen negativo (monitor a la izquierda) se conserva tal cual', async () => {
    const { backend } = mk([win(-1920, -200, 1000, 700)], 'pixelWidth: 1000\n  pixelHeight: 700\n')
    const loc = await backend.locateWindowShot('com.a.A', 0, { width: 2000, height: 1400 }, '/s/o.jpg')
    expect(loc?.rect).toEqual({ x: -1920, y: -200, width: 1000, height: 700 })
    expect(loc).toMatchObject({ imageWidth: 1000, imageHeight: 700 })
  })

  it('FALLA CERRADO: otra ventana de la misma app mide lo mismo (±2): no se sabe cuál capturó el helper (no se llama a sips)', async () => {
    const { backend, calls } = mk([win(0, 0, 800, 600), win(-1920, 50, 801, 599)])
    expect(await backend.locateWindowShot('com.a.A', 0, { width: 1600, height: 1200 }, '/s/o.jpg')).toBeNull()
    expect(calls.every((c) => c.cmd !== '/usr/bin/sips')).toBe(true)
    // Con tamaños distintos sí se ubica.
    expect(
      await mk([win(0, 0, 800, 600), win(5, 5, 300, 200)]).backend.locateWindowShot('com.a.A', 0, { width: 1600, height: 1200 }, '/s/o.jpg')
    ).not.toBeNull()
  })

  it('tolera ±2 px en la comprobación cruzada (frame × 2)', async () => {
    const { backend } = mk([win(0, 0, 800, 600)])
    expect(await backend.locateWindowShot('com.a.A', 0, { width: 1602, height: 1198 }, '/s/o.jpg')).not.toBeNull()
  })

  it('FALLA CERRADO: el tamaño del PNG no cuadra con frame × 2 (no se llama a sips)', async () => {
    const { backend, calls } = mk([win(0, 0, 800, 600)])
    expect(await backend.locateWindowShot('com.a.A', 0, { width: 1603, height: 1200 }, '/s/o.jpg')).toBeNull()
    expect(await backend.locateWindowShot('com.a.A', 0, { width: 1600, height: 1000 }, '/s/o.jpg')).toBeNull()
    expect(calls.every((c) => c.cmd !== '/usr/bin/sips')).toBe(true)
  })

  it('FALLA CERRADO: windows-of vacío, índice fuera, ventanas ≤ 40 px, salida rara, helper roto o sips sin medidas', async () => {
    expect(await mk([]).backend.locateWindowShot('com.a.A', 0, { width: 2, height: 2 }, '/s/o.jpg')).toBeNull()
    expect(await mk([win(0, 0, 800, 600)]).backend.locateWindowShot('com.a.A', 1, { width: 1600, height: 1200 }, '/s/o.jpg')).toBeNull()
    expect(await mk([win(0, 0, 40, 600)]).backend.locateWindowShot('com.a.A', 0, { width: 80, height: 1200 }, '/s/o.jpg')).toBeNull()
    expect(await mk({ no: 'lista' }).backend.locateWindowShot('com.a.A', 0, { width: 1600, height: 1200 }, '/s/o.jpg')).toBeNull()
    expect(
      await mk([win(0, 0, 800, 600)], 'nada').backend.locateWindowShot('com.a.A', 0, { width: 1600, height: 1200 }, '/s/o.jpg')
    ).toBeNull()
    const roto = rig(() => ({ code: 5 }))
    expect(await roto.backend.locateWindowShot('com.a.A', 0, { width: 1600, height: 1200 }, '/s/o.jpg')).toBeNull()
  })

  it('windowFrames devuelve los marcos de windows-of y descarta entradas sin números', async () => {
    const { backend } = mk([win(1, 2, 3, 4), { x: 'a', y: 0, width: 1, height: 1 }, null, win(-5, 6, 7, 8)])
    expect(await backend.windowFrames('com.a.A')).toEqual([
      { x: 1, y: 2, width: 3, height: 4 },
      { x: -5, y: 6, width: 7, height: 8 }
    ])
    await expect(rig(() => ({ code: 5 })).backend.windowFrames('com.a.A')).rejects.toThrow()
  })

  it('windowShot NO cambia: sigue devolviendo solo lo que dice el helper', async () => {
    const { backend } = mk([])
    const r = rig((cmd, args) =>
      cmd === '/usr/bin/sips' ? {} : args[0] === 'window-shot' ? { stdout: '{"ok":true,"width":800,"height":600}' } : {}
    )
    expect(await r.backend.windowShot('com.a.A', '/s/raw.png', '/s/o.jpg', 0)).toEqual({ ok: true, width: 800, height: 600 })
    expect(backend.windowShot).toBeTypeOf('function')
  })
})

describe('macOS: sonda, zoom y ventana tapada (probeWindow / zoomWindow / occlusion)', () => {
  const SCREENS = [{ width: 1440, height: 900, scale: 2, main: true, x: 0, y: 0 }]
  const FRAME = { x: 100, y: 100, width: 800, height: 600 }
  const rect = (x: number, y: number, width: number, height: number): Record<string, number> => ({ x, y, width, height })
  const APPS = JSON.stringify([
    { bundleId: 'com.a.A', name: 'A' },
    { bundleId: 'com.b.B', name: 'B' }
  ])
  const names = (calls: Call[]): string[] => calls.map((c) => c.args[0] ?? c.cmd)

  it('probeWindow: window-shot a PNG (sin sips) y devuelve el tamaño', async () => {
    const { backend, calls } = rig(
      (_c, args) => (args[0] === 'window-shot' ? { stdout: '{"ok":true,"width":1600,"height":1200}' } : {}),
      {},
      {},
      new Set(['/h/cu-helper', '/s/p.png'])
    )
    expect(await backend.probeWindow('com.a.A', 1, '/s/p.png')).toEqual({ width: 1600, height: 1200 })
    expect(calls).toEqual([{ cmd: '/h/cu-helper', args: ['window-shot', 'com.a.A', '/s/p.png', '1'] }])
  })

  it('probeWindow: falla si el helper sale con error o no escribió el archivo', async () => {
    await expect(rig(() => ({ code: 7 })).backend.probeWindow('com.a.A', 0, '/s/p.png')).rejects.toThrow('no está en ejecución')
    await expect(rig(() => ({ stdout: '{"width":1,"height":1}' })).backend.probeWindow('com.a.A', 0, '/s/p.png')).rejects.toThrow(
      'no escribió'
    )
  })

  const zoomReq = {
    appKey: 'com.a.A',
    windowIndex: 0,
    srcPath: '/s/raw.png',
    outPath: '/s/z.jpg',
    region: { x: 10.4, y: 20, width: 300, height: 200 },
    scale: 2,
    maxLong: 1366
  }
  const zfiles = new Set(['/h/cu-helper', '/s/raw.png'])

  it('zoomWindow: zoom-image sobre el PNG conservado; si cabe en el tope no llama a sips', async () => {
    const { backend, calls } = rig((_c, args) => (args[0] === 'zoom-image' ? { stdout: '{"width":600,"height":400}' } : {}), {}, {}, zfiles)
    expect(await backend.zoomWindow(zoomReq)).toEqual({ width: 600, height: 400 })
    expect(calls).toEqual([{ cmd: '/h/cu-helper', args: ['zoom-image', '/s/raw.png', '/s/z.jpg', '10', '20', '300', '200', '2'] }])
  })

  it('zoomWindow: si pasa del tope, sips -Z sobre el resultado y se vuelve a medir', async () => {
    const { backend, calls } = rig(
      (cmd, args) =>
        args[0] === 'zoom-image'
          ? { stdout: '{"width":2000,"height":1200}' }
          : cmd === '/usr/bin/sips' && args[0] === '-g'
            ? { stdout: 'pixelWidth: 1000\n  pixelHeight: 600\n' }
            : {},
      {},
      {},
      zfiles
    )
    expect(await backend.zoomWindow({ ...zoomReq, maxLong: 1000 })).toEqual({ width: 1000, height: 600 })
    expect(calls.slice(1)).toEqual([
      { cmd: '/usr/bin/sips', args: ['-Z', '1000', '/s/z.jpg'] },
      { cmd: '/usr/bin/sips', args: ['-g', 'pixelWidth', '-g', 'pixelHeight', '/s/z.jpg'] }
    ])
  })

  it('zoomWindow: sin PNG conservado o con región inválida no llama al helper', async () => {
    const r = rig(() => ({}), {}, {}, new Set(['/h/cu-helper']))
    await expect(r.backend.zoomWindow(zoomReq)).rejects.toThrow('ya no existe')
    const r2 = rig(() => ({}), {}, {}, zfiles)
    await expect(r2.backend.zoomWindow({ ...zoomReq, region: { x: 0, y: 0, width: 0, height: 5 } })).rejects.toThrow('región')
    await expect(r2.backend.zoomWindow({ ...zoomReq, scale: Number.NaN })).rejects.toThrow('región')
    expect(r.calls.length + r2.calls.length).toBe(0)
  })

  it('zoomWindow (H1): la entrada debe ser un archivo regular, no un enlace ni vacío; si no, no llama al helper', async () => {
    const mk = (st: ReturnType<DarwinDeps['lstatSync']>): ReturnType<typeof rig> =>
      rig(
        () => ({}),
        {},
        {},
        zfiles,
        async () => ({}),
        () => st
      )
    const casos = [
      { isFile: () => false, isSymbolicLink: () => true, size: 100 },
      { isFile: () => true, isSymbolicLink: () => true, size: 100 },
      { isFile: () => false, isSymbolicLink: () => false, size: 100 },
      { isFile: () => true, isSymbolicLink: () => false, size: 0 }
    ]
    for (const st of casos) {
      const r = mk(st)
      await expect(r.backend.zoomWindow(zoomReq)).rejects.toThrow('no es un archivo válido')
      expect(r.calls).toEqual([])
    }
    const gone = rig(
      () => ({}),
      {},
      {},
      zfiles,
      async () => ({}),
      () => {
        throw new Error('ENOENT')
      }
    )
    await expect(gone.backend.zoomWindow(zoomReq)).rejects.toThrow('ya no existe')
    expect(gone.calls).toEqual([])
  })

  /** Escenario: la app A (frame) con `windows-of` en orden Z; `at` es la respuesta de `app-at` por llamada. */
  const scene = (
    wins: unknown,
    at: (n: number) => Reply = () => ({ stdout: '{"name":"Brave Browser","bundleId":"com.brave.Browser"}' })
  ) => {
    let n = 0
    return rig((_c, args) => {
      if (args[0] === 'running-apps') return { stdout: APPS }
      if (args[0] === 'windows-of') return { stdout: JSON.stringify(wins) }
      if (args[0] === 'app-at') return at(++n)
      return {}
    })
  }

  it('sin tapar: SOLO 2 llamadas (running-apps y windows-of con todas las apps)', async () => {
    const { backend, calls } = scene([rect(100, 100, 800, 600), rect(0, 0, 1440, 900)])
    const res = await backend.occlusion('com.a.A', FRAME, [FRAME], SCREENS)
    expect(res).toMatchObject({ known: true, coveredPct: 0, offscreenPct: 0, coveredBy: [] })
    expect(calls).toEqual([
      { cmd: '/h/cu-helper', args: ['running-apps'] },
      { cmd: '/h/cu-helper', args: ['windows-of', 'com.a.A,com.b.B'] }
    ])
  })

  it('tapada por una ventana encima: running-apps, windows-of y un app-at en el centro de la zona tapada (3 llamadas)', async () => {
    // La ventana de Brave (primera de la lista, delante) cubre la mitad derecha de la capturada.
    const { backend, calls } = scene([rect(500, 100, 600, 600), rect(100, 100, 800, 600), rect(0, 0, 1440, 900)])
    const res = await backend.occlusion('com.a.A', FRAME, [FRAME], SCREENS)
    expect(names(calls)).toEqual(['running-apps', 'windows-of', 'app-at'])
    expect(calls[2].args).toEqual(['app-at', '700', '400'])
    expect(res.known && res.coveredPct).toBeCloseTo(50, 0)
    expect(res.known && res.coveredBy).toEqual([expect.objectContaining({ app: 'Brave Browser' })])
  })

  it('varias ventanas encima: como mucho 5 llamadas en total y se suman las de la misma app', async () => {
    const { backend, calls } = scene([
      rect(100, 100, 200, 600),
      rect(300, 100, 200, 600),
      rect(500, 100, 200, 600),
      rect(700, 100, 100, 600),
      rect(100, 100, 800, 600)
    ])
    const res = await backend.occlusion('com.a.A', FRAME, [FRAME], SCREENS)
    expect(calls.length).toBeLessThanOrEqual(5)
    // Las 3 primeras caen en 3 app-at, todas «Brave Browser»: una sola fila con la suma.
    expect(res.known && res.coveredBy.map((c) => c.app)).toEqual(['Brave Browser'])
    expect(res.known && res.coveredBy[0].pct).toBeCloseTo(75, 0)
  })

  it('las ventanas de la propia app (ownFrames) no tapan', async () => {
    const aux = rect(300, 200, 200, 200)
    const { backend, calls } = scene([aux, rect(100, 100, 800, 600)])
    const res = await backend.occlusion('com.a.A', FRAME, [FRAME, { x: 300, y: 200, width: 200, height: 200 }], SCREENS)
    expect(res).toMatchObject({ known: true, coveredPct: 0 })
    expect(calls.length).toBe(2)
  })

  it('app-at que tarda más de 1,5 s: la tapa se avisa SIN nombre («otra ventana»)', async () => {
    vi.useFakeTimers()
    try {
      const { backend } = scene([rect(500, 100, 600, 600), rect(100, 100, 800, 600)], () => ({ stdout: '{"name":"Lenta"}', delayMs: 5000 }))
      const p = backend.occlusion('com.a.A', FRAME, [FRAME], SCREENS)
      await vi.advanceTimersByTimeAsync(1600)
      const res = await p
      expect(res.known && res.coveredBy.map((c) => c.app)).toEqual(['otra ventana'])
      await vi.advanceTimersByTimeAsync(5000)
    } finally {
      vi.useRealTimers()
    }
  })

  it('app-at que falla, sin nombre o que responde la propia app: «otra ventana»; el nombre se limpia de controles', async () => {
    for (const reply of [{ code: 1 }, { stdout: '{"name":"","bundleId":""}' }, { stdout: '{"name":"A","bundleId":"com.a.A"}' }]) {
      const res = await scene([rect(500, 100, 600, 600), rect(100, 100, 800, 600)], () => reply).backend.occlusion(
        'com.a.A',
        FRAME,
        [FRAME],
        SCREENS
      )
      expect(res.known && res.coveredBy.map((c) => c.app)).toEqual(['otra ventana'])
    }
    const sucio = await scene([rect(500, 100, 600, 600), rect(100, 100, 800, 600)], () => ({
      stdout: '{"name":"Mal\\nApp\\u0007"}'
    })).backend.occlusion('com.a.A', FRAME, [FRAME], SCREENS)
    expect(sucio.known && sucio.coveredBy[0].app).toBe('Mal App')
  })

  it('ventana ambigua (el marco aparece dos veces) o ausente → known:false, sin app-at', async () => {
    const dup = scene([rect(100, 100, 800, 600), rect(100, 100, 800, 600)])
    expect(await dup.backend.occlusion('com.a.A', FRAME, [], SCREENS)).toEqual({ known: false })
    const none = scene([rect(0, 0, 1440, 900)])
    expect(await none.backend.occlusion('com.a.A', FRAME, [], SCREENS)).toEqual({ known: false })
    expect(names(dup.calls).includes('app-at') || names(none.calls).includes('app-at')).toBe(false)
  })

  it('fuera de pantalla se cuenta; sin pantallas, helper roto o salida rara → known:false (nunca lanza)', async () => {
    const off = await scene([rect(1200, 100, 800, 600)]).backend.occlusion(
      'com.a.A',
      { x: 1200, y: 100, width: 800, height: 600 },
      [],
      SCREENS
    )
    // ~70 % de la ventana cae a la derecha del único monitor (la rejilla 32×32 lo cuantiza a 68,75).
    expect(off.known && off.offscreenPct).toBeGreaterThan(65)
    expect(off.known && off.offscreenPct).toBeLessThan(75)
    expect(await scene([rect(100, 100, 800, 600)]).backend.occlusion('com.a.A', FRAME, [], [])).toEqual({ known: false })
    expect(await rig(() => ({ code: 5 })).backend.occlusion('com.a.A', FRAME, [], SCREENS)).toEqual({ known: false })
    expect(await scene({ no: 'lista' }).backend.occlusion('com.a.A', FRAME, [], SCREENS)).toEqual({ known: false })
  })

  it('windowShot de macOS no cambia: ignora un 5.º argumento y no pide nada nuevo al helper', async () => {
    const r = rig((cmd, args) =>
      cmd === '/usr/bin/sips' ? {} : args[0] === 'window-shot' ? { stdout: '{"ok":true,"width":8,"height":6}' } : {}
    )
    await r.backend.windowShot('com.a.A', '/s/raw.png', '/s/o.jpg', 0, '/s/p.png')
    expect(r.calls[0]).toEqual({ cmd: '/h/cu-helper', args: ['window-shot', 'com.a.A', '/s/raw.png', '0'] })
  })
})
