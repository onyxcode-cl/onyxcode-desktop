/**
 * Backend de macOS del MCP de Control del Mac, con `execFile` y el sistema de archivos simulados: fija los comandos EXACTOS
 * (binario, argumentos, banderas) de las ramas que `mcp-server.equivalence.test.ts` no puede recorrer sin tocar la pantalla real
 * (ScreenCaptureKit, `screencapture`, enmascarado, `sips`, Spotlight). Los literales son los del código de antes de abstraer.
 * No ejecuta ningún binario del sistema.
 */
import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import type { PlatformHost } from './mcp-platform'
import { createDarwinBackend } from './mcp-platform-darwin'

type Reply = { stdout?: string; stderr?: string; code?: number }
interface Call {
  cmd: string
  args: string[]
}

function rig(
  reply: (cmd: string, args: string[]) => Reply,
  cfg: Partial<PlatformHost['config']> = {},
  tiers: Record<string, 'view' | 'click' | 'full' | null> = {},
  files: Set<string> = new Set(['/h/cu-helper'])
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
    queueMicrotask(() => {
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
    sideGet: async () => ({})
  }
  const backend = createDarwinBackend(host, {
    execFile,
    existsSync: (p) => files.has(p),
    readdirSync: () => {
      throw new Error('sin carpeta')
    },
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

  it('resolver app: helper → bundle id (mdfind + plutil) → Spotlight por nombre → recorrido de carpetas', async () => {
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
