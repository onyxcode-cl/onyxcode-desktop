/**
 * Backend de Windows del MCP de Control del PC (plan C, C3) con el helper FALSO (`e2e/fake-cu-helper/fake.mjs`, emula el protocolo
 * de `resources/computer-use/protocol.json`) y un canal lateral simulado. Se prueba el MCP real, empaquetado como en producción,
 * con `COMPUTER_BACKEND=win32` y `CU_HELPER_ARGV0=node`: no hace falta Windows ni se toca el ratón, el teclado ni la pantalla.
 * NADA de esto sustituye a la prueba en un Windows real (visita al PC n.º 1 del plan).
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { EventEmitter } from 'node:events'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { FAKE_HELPER, bundleMcp, startMcp, startSideChannel, textOf, tmpWork, type McpProc, type SideChannel } from '../../test/cu-mcp-kit'
import type { PlatformHost } from './mcp-platform'
import { WIN_HELPER_LIMITS, createWin32Backend, encodeKeyItem, imageSize } from './mcp-platform-win32'
import { exeKey } from './policy/app-key'

const ROOT = join(__dirname, '..', '..', '..')
const proto = JSON.parse(readFileSync(join(ROOT, 'resources', 'computer-use', 'protocol.json'), 'utf8')) as {
  version: number
  io: { timeoutMs: number; maxOutputBytes: number }
  commands: Record<string, { win32: string; replacedBy?: string }>
  windowsExtensions: Record<string, unknown>
  win32Contract: { limits: { timeoutMs: number; maxOutputBytes: number; stopGraceMs: number }; protocol: number }
}

const key = (path: string, pub: string): string => {
  const r = exeKey(path, pub)
  if (!r.ok) throw new Error(r.reason)
  return r.key
}
const NOTEPAD = key('C:\\Windows\\System32\\notepad.exe', 'Microsoft Windows')
const CHROME = key('C:\\Program Files\\Goo,gle\\Chrome\\chrome.exe', 'Google LLC') // la coma obliga a codificar --mask-keys
const LAZUNOX = key('C:\\Users\\Ana\\AppData\\Local\\Programs\\Lazunox\\Lazunox.exe', '')

// Cada prueba arranca el MCP y el helper falso como procesos: con la máquina cargada pueden pasar de los 5 s por defecto.
vi.setConfig({ testTimeout: 30_000 })

const work = tmpWork('lzx-mcp-win')
let bundle = ''
beforeAll(() => {
  bundle = bundleMcp(work.dir)
})
afterAll(() => work.cleanup())

const APPS = [
  { name: 'Lazunox', appKey: LAZUNOX, pid: 1 },
  { name: 'Bloc de notas', appKey: NOTEPAD, pid: 2 },
  { name: 'Chrome', appKey: CHROME, pid: 3 }
]

function script(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    responses: {
      version: { out: { protocol: 1, helper: 'fake-1.0.0', platform: 'win32' } },
      session: { out: { interactive: true, secureDesktop: false, elevatedTarget: false } },
      screens: { out: [{ width: 2560, height: 1440, scale: 1.5, dpiScale: 1.5, x: 0, y: 0, main: true }] },
      frontmost: { out: { name: 'Bloc de notas', bundleId: NOTEPAD, pid: 2 } },
      'app-at': { out: { name: 'Bloc de notas', bundleId: NOTEPAD, pid: 2 } },
      'list-apps': { out: APPS },
      screenshot: { writeImage: true, out: { width: 1366, height: 768, ratio: 1.8741, masked: 1 } },
      ...over
    }
  }
}

let seq = 0
async function boot(
  o: {
    script?: Record<string, unknown>
    side?: Parameters<typeof startSideChannel>[0] | false
    env?: Record<string, string>
  } = {}
): Promise<{ mcp: McpProc; side?: SideChannel; done: () => Promise<void> }> {
  const side = o.side === false ? undefined : await startSideChannel({ tier: (k) => (k === NOTEPAD ? 'full' : null), ...o.side })
  const mcp = await startMcp({
    bundle,
    helper: FAKE_HELPER,
    dir: join(work.dir, `w${++seq}`),
    platform: 'win32',
    events: side,
    script: o.script ?? script(),
    env: { COMPUTER_BACKEND: 'win32', CU_HELPER_ARGV0: 'node', COMPUTER_AUTO_SCREENSHOT: '0', COMPUTER_INSTANT: '1', ...o.env }
  })
  return {
    mcp,
    side,
    done: async () => {
      await mcp.stop()
      await side?.close()
    }
  }
}

const cmds = (m: McpProc): string[] => m.calls().map((c) => c.cmd)
const shots = (m: McpProc): string[] => {
  try {
    return readdirSync(m.shotDir).filter((f) => f.startsWith('shot-'))
  } catch {
    return []
  }
}
const until = async (f: () => boolean, ms = 4000): Promise<void> => {
  const t = Date.now()
  while (!f() && Date.now() - t < ms) await new Promise((r) => setTimeout(r, 25))
}

describe('contrato: lo que el MCP de Windows envía existe en protocol.json', () => {
  it('los límites del backend son los del contrato', () => {
    expect(WIN_HELPER_LIMITS.protocol).toBe(proto.version)
    expect(WIN_HELPER_LIMITS.protocol).toBe(proto.win32Contract.protocol)
    expect(WIN_HELPER_LIMITS.timeoutMs).toBe(proto.io.timeoutMs)
    expect(WIN_HELPER_LIMITS.timeoutMs).toBe(proto.win32Contract.limits.timeoutMs)
    expect(WIN_HELPER_LIMITS.maxOutputBytes).toBe(proto.io.maxOutputBytes)
    expect(WIN_HELPER_LIMITS.maxOutputBytes).toBe(proto.win32Contract.limits.maxOutputBytes)
    expect(WIN_HELPER_LIMITS.stopGraceMs).toBe(proto.win32Contract.limits.stopGraceMs)
  })
  it('todo comando literal de mcp-server.ts y del backend de Windows existe para win32 (misma paridad, no «none» ni «replaced»)', () => {
    const found = new Set<string>()
    for (const f of ['mcp-server.ts', 'mcp-platform-win32.ts']) {
      const src = readFileSync(join(__dirname, f), 'utf8')
      for (const m of src.matchAll(/\b(?:helper|helperExit)\(\s*'([a-z-]+)'/g)) found.add(m[1])
      for (const m of src.matchAll(/launch\(\['([a-z-]+)'/g)) found.add(m[1])
    }
    expect([...found].length).toBeGreaterThan(15)
    for (const c of found) {
      const inCommands = proto.commands[c]
      const ok = inCommands ? inCommands.win32 === 'same' : c in proto.windowsExtensions
      expect(ok, `comando «${c}» no disponible para win32 en el contrato`).toBe(true)
    }
  })
  it('las comas y los % de una clave de app se codifican en --mask-keys', () => {
    expect(encodeKeyItem('exe:c:\\a,b\\x.exe|pub:100%')).toBe('exe:c:\\a%2Cb\\x.exe|pub:100%25')
  })
  it('imageSize lee PNG y JPEG', () => {
    expect(imageSize(Buffer.from('/9j/4AAQSkZJRgABAQAA', 'base64'))).toBeNull()
  })
})

describe('Windows: textos y herramientas', () => {
  it('initialize y tools/list hablan de Windows y de ctrl, no de cmd', async () => {
    const { mcp, done } = await boot({ side: false })
    try {
      const init = await mcp.rpc('initialize', { protocolVersion: '2025-06-18' })
      expect((init.result as { instructions: string }).instructions).toMatch(/PC con Windows/)
      const list = (await mcp.rpc('tools/list')).result as { tools: Array<{ name: string; description: string }> }
      const key = list.tools.find((t) => t.name === 'key')!
      expect(key.description).toMatch(/ctrl/)
      expect(key.description).not.toMatch(/cmd\+space/)
      // Las mismas herramientas que en macOS (el fixture de caracterización las fijó antes de abstraer).
      const fixture = JSON.parse(readFileSync(join(__dirname, 'mcp-server.equivalence.fixture.json'), 'utf8')) as Record<
        string,
        Array<{ res: { result?: { tools: Array<{ name: string }> } } }>
      >
      const macTools = fixture['protocolo-y-herramientas'][1].res.result!.tools.map((t) => t.name)
      expect(list.tools.map((t) => t.name)).toEqual(macTools)
    } finally {
      await done()
    }
  })
})

describe('Windows: capturas que FALLAN CERRADO', () => {
  it('camino feliz: list-apps antes y después, máscara codificada de lo que no tiene concesión, y se excluye a Lazunox', async () => {
    const { mcp, done } = await boot()
    try {
      const r = await mcp.call('screenshot')
      expect(r.isError).toBeFalsy()
      expect(r.content.map((c) => c.type)).toEqual(['image', 'text'])
      expect(textOf(r)).toMatch(/1366x768 px/)
      const c = mcp.calls()
      // `frontmost` nueva: `takeScreenshot` ahora también pregunta qué app está en primer plano, EN
      // PARALELO a la captura (`Promise.all`), para poder decirle al modelo qué está viendo (F8-B140)
      // — por eso su posición exacta entre "session" y "screenshot" no es determinista (depende de
      // qué tick de microtareas termine primero), a diferencia del resto de la secuencia. Se separa:
      // que haya pasado en algún punto temprano, y que el RESTO (sin "frontmost") sea el de siempre.
      const cmds = c.map((x) => x.cmd)
      expect(cmds).toContain('frontmost')
      expect(cmds.filter((cmd) => cmd !== 'frontmost')).toEqual(['version', 'session', 'list-apps', 'screenshot', 'list-apps', 'screens'])
      expect(cmds.indexOf('frontmost')).toBeGreaterThan(cmds.indexOf('session'))
      expect(cmds.indexOf('frontmost')).toBeLessThan(cmds.indexOf('screenshot'))
      const shot = c.find((x) => x.cmd === 'screenshot')!
      expect(shot.args.slice(1)).toEqual(['--max-long', '1366', '--quality', '70', '--mask-keys', encodeKeyItem(CHROME)])
      expect(shot.args[0]).toMatch(/shot-.*\.jpg$/)
      expect(shot.args.join(' ')).not.toContain(NOTEPAD) // concedida
      expect(shot.args.join(' ')).not.toContain(LAZUNOX) // exenta
    } finally {
      await done()
    }
  })

  it('sin apps sin concesión no pasa --mask-keys', async () => {
    const { mcp, done } = await boot({ side: { tier: () => 'view' } })
    try {
      expect((await mcp.call('screenshot')).isError).toBeFalsy()
      expect(mcp.calls().find((x) => x.cmd === 'screenshot')!.args).not.toContain('--mask-keys')
    } finally {
      await done()
    }
  })

  it('las coordenadas se convierten con píxeles físicos (scale forzado a 1, aunque el helper diga 1,5)', async () => {
    const { mcp, done } = await boot()
    try {
      await mcp.call('screenshot')
      const r = await mcp.call('left_click', { x: 100, y: 50 })
      const ratio = 2560 / 1366
      const px = Math.round(100 * ratio * 100) / 100
      const py = Math.round(50 * ratio * 100) / 100
      expect(textOf(r)).toContain(`→ (${px}, ${py}) pt`)
      expect(mcp.calls().find((x) => x.cmd === 'click')!.args).toEqual([String(px), String(py), 'left', '1'])
    } finally {
      await done()
    }
  })

  const closed: Array<[string, Record<string, unknown>, Parameters<typeof startSideChannel>[0] | false, RegExp]> = [
    ['list-apps falla', script({ 'list-apps': { exit: 12, stderr: 'x' } }), {}, /No se hace la captura/],
    [
      'list-apps con una entrada sin clave válida',
      script({ 'list-apps': { out: [{ name: 'X', appKey: 'nada', pid: 1 }] } }),
      {},
      /sin clave válida/
    ],
    [
      'el helper no puede enmascarar (12)',
      script({ screenshot: { writeImage: true, exit: 12, stderr: 'no' } }),
      {},
      /No se hace la captura/
    ],
    [
      'hay una ventana bloqueada que no se pudo ocultar (11)',
      script({ screenshot: { writeImage: true, exit: 11 } }),
      {},
      /No se hace la captura/
    ],
    ['respuesta que no es JSON', script({ screenshot: { writeImage: true, raw: 'basura' } }), {}, /respuesta ilegible/],
    ['sin tamaño', script({ screenshot: { writeImage: true, out: { masked: 0 } } }), {}, /tamaño/],
    ['tamaño cero', script({ screenshot: { writeImage: true, out: { width: 0, height: 10, masked: 0 } } }), {}, /tamaño/],
    ['tamaño no entero', script({ screenshot: { writeImage: true, out: { width: 10.5, height: 10, masked: 0 } } }), {}, /tamaño/],
    [
      'sin recuento de ventanas enmascaradas',
      script({ screenshot: { writeImage: true, out: { width: 10, height: 10 } } }),
      {},
      /enmascaró/
    ],
    ['el helper no escribió la imagen', script({ screenshot: { out: { width: 10, height: 10, masked: 0 } } }), {}, /no escribió la imagen/],
    [
      'carrera: apareció otra app sin concesión mientras se capturaba',
      script({ 'list-apps': [{ out: APPS.slice(0, 2) }, { out: APPS }] }),
      {},
      /cambió el conjunto de apps/
    ]
  ]
  it.each(closed)('no hay captura (y no queda archivo): %s', async (_name, scr, side, re) => {
    const { mcp, done } = await boot({ script: scr, side })
    try {
      const r = await mcp.call('screenshot')
      expect(r.isError).toBe(true)
      expect(r.content.some((c) => c.type === 'image')).toBe(false)
      expect(textOf(r)).toMatch(re)
      expect(shots(mcp)).toEqual([])
    } finally {
      await done()
    }
  })

  it('la captura automática tras una acción también falla cerrado (la acción se hizo, sin imagen)', async () => {
    const { mcp, done } = await boot({
      script: script({ screenshot: { writeImage: true, exit: 12 } }),
      env: { COMPUTER_AUTO_SCREENSHOT: '1' }
    })
    try {
      const r = await mcp.call('left_click', { x: 10, y: 10 })
      expect(r.isError).toBeFalsy()
      expect(r.content.some((c) => c.type === 'image')).toBe(false)
      expect(textOf(r)).toMatch(/\(sin captura: No se hace la captura/)
    } finally {
      await done()
    }
  })

  it('app_screenshot: window-shot con --max-long/--quality, sin PNG intermedio ni sips', async () => {
    const { mcp, done } = await boot()
    try {
      const r = await mcp.call('app_screenshot', { app: 'Bloc de notas', window: 1 })
      expect(r.isError).toBeFalsy()
      expect(r.content.some((c) => c.type === 'image')).toBe(true)
      const w = mcp.calls().find((x) => x.cmd === 'window-shot')!
      expect(w.args[0]).toBe(NOTEPAD)
      expect(w.args[1]).toMatch(/shot-app-.*\.jpg$/)
      expect(w.args.slice(2)).toEqual(['1', '--max-long', '1366', '--quality', '70'])
    } finally {
      await done()
    }
  })

  it('window-shot de una app bloqueada (11) da el mensaje de «hazlo tú» y no deja imagen', async () => {
    const { mcp, done } = await boot({ script: script({ 'window-shot': { exit: 11 } }) })
    try {
      const r = await mcp.call('app_screenshot', { app: 'Bloc de notas' })
      expect(r.isError).toBe(true)
      expect(textOf(r)).toMatch(/bloqueado o con permisos de administrador/)
    } finally {
      await done()
    }
  })
})

describe('Windows: consentimiento de la app, versión del protocolo y sesión', () => {
  it('sin consentimiento no se ejecuta NADA salvo la comprobación de versión', async () => {
    const { mcp, done } = await boot({ side: { consent: () => ({ consent: false, version: 1 }) } })
    try {
      for (const [tool, args] of [
        ['screenshot', {}],
        ['left_click', { x: 1, y: 1 }],
        ['cursor_position', {}],
        ['request_access', { apps: [], plan: ['x'] }],
        ['app_tree', { app: 'Bloc de notas' }]
      ] as const) {
        const r = await mcp.call(tool, args)
        expect(r.isError, tool).toBe(true)
        expect(textOf(r), tool).toMatch(/Control del PC no está activado/)
      }
      expect(new Set(cmds(mcp))).toEqual(new Set(['version']))
    } finally {
      await done()
    }
  })

  it('revocar el consentimiento surte efecto en la siguiente herramienta', async () => {
    let on = true
    const { mcp, done } = await boot({ side: { consent: () => ({ consent: on, version: 1 }) } })
    try {
      expect((await mcp.call('cursor_position')).isError).toBeFalsy()
      on = false
      await new Promise((r) => setTimeout(r, 260)) // caché de 200 ms
      const r = await mcp.call('cursor_position')
      expect(r.isError).toBe(true)
      expect(textOf(r)).toMatch(/no está activado/)
    } finally {
      await done()
    }
  })

  it('si no se puede verificar el consentimiento, se rechaza (falla cerrado)', async () => {
    const { mcp, done } = await boot({ side: { consent: null } })
    try {
      const r = await mcp.call('cursor_position')
      expect(r.isError).toBe(true)
      expect(textOf(r)).toMatch(/No se pudo verificar el consentimiento/)
    } finally {
      await done()
    }
  })

  it('un helper de otro protocolo, ilegible o que no conoce `version` es incompatible', async () => {
    for (const v of [{ out: { protocol: 2 } }, { raw: 'no json' }, { exit: 1, stderr: 'comando desconocido' }, { out: {} }]) {
      const { mcp, done } = await boot({ script: script({ version: v }) })
      try {
        const r = await mcp.call('cursor_position')
        expect(r.isError).toBe(true)
        expect(textOf(r)).toMatch(/versión incompatible/)
        expect(cmds(mcp)).toEqual(['version'])
      } finally {
        await done()
      }
    }
  })

  it('la versión se comprueba una sola vez por proceso', async () => {
    const { mcp, done } = await boot()
    try {
      await mcp.call('cursor_position')
      await mcp.call('cursor_position')
      expect(cmds(mcp).filter((c) => c === 'version').length).toBe(1)
    } finally {
      await done()
    }
  })

  it.each([
    ['sesión no interactiva (SSH)', { exit: 12, stderr: 'sin escritorio' }],
    ['interactive=false', { out: { interactive: false, secureDesktop: false, elevatedTarget: false } }],
    ['escritorio seguro (UAC, bloqueo)', { out: { interactive: true, secureDesktop: true, elevatedTarget: false } }],
    ['respuesta ilegible', { raw: '???' }]
  ])('%s: ninguna herramienta actúa (código 12 traducido al modelo)', async (_n, session) => {
    const { mcp, done } = await boot({ script: script({ session }) })
    try {
      for (const [tool, args] of [
        ['screenshot', {}],
        ['left_click', { x: 1, y: 1 }]
      ] as const) {
        const r = await mcp.call(tool, args)
        expect(r.isError, tool).toBe(true)
        expect(textOf(r), tool).toMatch(/escritorio interactivo/)
      }
      expect(cmds(mcp).filter((c) => !['version', 'session'].includes(c))).toEqual([])
    } finally {
      await done()
    }
  })

  it('ventana de destino elevada: ratón y teclado reales rechazados; capturar y UI Automation siguen (la máscara la pone el helper)', async () => {
    const { mcp, done } = await boot({
      script: script({ session: { out: { interactive: true, secureDesktop: false, elevatedTarget: true } } })
    })
    try {
      for (const [tool, args] of [
        ['left_click', { x: 1, y: 1 }],
        ['type_text', { text: 'x' }],
        ['key', { keys: 'enter' }]
      ] as const) {
        const r = await mcp.call(tool, args)
        expect(r.isError, tool).toBe(true)
        expect(textOf(r), tool).toBe(
          'La ventana pertenece a un programa con permisos de administrador; Lazunox no puede ni debe controlarla. Hazlo tú.'
        )
      }
      expect((await mcp.call('screenshot')).isError).toBeFalsy()
      expect((await mcp.call('app_tree', { app: 'Bloc de notas' })).isError).toBeFalsy()
      expect(cmds(mcp)).not.toContain('click')
      expect(cmds(mcp)).not.toContain('type')
      expect(cmds(mcp)).not.toContain('key')
    } finally {
      await done()
    }
  })

  it('una ventana de destino sin clave válida se rechaza (en macOS no bloquea; en Windows falla cerrado)', async () => {
    for (const front of [
      { name: 'X', bundleId: '' },
      { name: 'X', bundleId: 'com.apple.Notes' },
      { name: 'X', bundleId: 'exe:relativa|pub:x' }
    ]) {
      const { mcp, done } = await boot({ script: script({ frontmost: { out: front } }) })
      try {
        await mcp.call('screenshot')
        const r = await mcp.call('left_click', { x: 5, y: 5 })
        expect(r.isError).toBe(true)
        expect(textOf(r)).toMatch(/No se pudo identificar la ventana de destino/)
        expect(cmds(mcp)).not.toContain('click')
      } finally {
        await done()
      }
    }
  })

  it('la app bajo el punto también falla cerrado si no se identifica', async () => {
    const { mcp, done } = await boot({ script: script({ 'app-at': { out: { name: 'Nada', bundleId: '' } } }) })
    try {
      await mcp.call('screenshot')
      const r = await mcp.call('left_click', { x: 5, y: 5 })
      expect(r.isError).toBe(true)
      expect(cmds(mcp)).not.toContain('click')
    } finally {
      await done()
    }
  })

  it('la clave de app puede venir como appKey y se reenvía tal cual al canal lateral', async () => {
    const { mcp, side, done } = await boot({
      script: script({
        frontmost: { out: { name: 'Bloc de notas', appKey: NOTEPAD } },
        'app-at': { out: { name: 'Bloc de notas', appKey: NOTEPAD } }
      })
    })
    try {
      await mcp.call('screenshot')
      expect((await mcp.call('left_click', { x: 5, y: 5 })).isError).toBeFalsy()
      const tiers = side!.requests.filter((r) => r.path === '/tier').map((r) => r.query.bundleId)
      expect(tiers).toContain(NOTEPAD)
    } finally {
      await done()
    }
  })
})

describe('Windows: política de teclas', () => {
  it.each([
    ['cmd+c', /ctrl/i],
    ['win+r', /./],
    ['ctrl+shift+escape', /./],
    ['Ctrl+Alt+Shift+Esc', /./], // el propio atajo de parada
    ['ctrl+alt+del', /./]
  ])('«%s» se rechaza sin llegar al helper', async (keys, re) => {
    const { mcp, done } = await boot()
    try {
      const r = await mcp.call('key', { keys })
      expect(r.isError).toBe(true)
      expect(textOf(r)).toMatch(re)
      expect(cmds(mcp)).not.toContain('key')
    } finally {
      await done()
    }
  })

  it('una combinación permitida llega canónica al helper', async () => {
    const { mcp, done } = await boot()
    try {
      const r = await mcp.call('key', { keys: 'Control+Shift+T Return' })
      expect(r.isError).toBeFalsy()
      expect(mcp.calls().find((x) => x.cmd === 'key')!.args).toEqual(['ctrl+shift+t enter'])
      expect(textOf(r)).toContain('Teclas pulsadas: Control+Shift+T Return')
    } finally {
      await done()
    }
  })

  it('alt+f4 con Lazunox en primer plano se rechaza; con otra app se deja pasar', async () => {
    const lz = await boot({ script: script({ frontmost: { out: { name: 'Lazunox', bundleId: LAZUNOX } } }) })
    try {
      const r = await lz.mcp.call('key', { keys: 'alt+f4' })
      expect(r.isError).toBe(true)
      expect(cmds(lz.mcp)).not.toContain('key')
    } finally {
      await lz.done()
    }
    const other = await boot()
    try {
      expect((await other.mcp.call('key', { keys: 'alt+f4' })).isError).toBeFalsy()
      expect(cmds(other.mcp)).toContain('key')
    } finally {
      await other.done()
    }
  })

  it('si no se sabe quién tiene el foco, alt+f4 se rechaza (lo más restrictivo)', async () => {
    const { mcp, done } = await boot({ script: script({ frontmost: { exit: 1, stderr: 'x' } }) })
    try {
      expect((await mcp.call('key', { keys: 'alt+f4' })).isError).toBe(true)
    } finally {
      await done()
    }
  })
})

describe('Windows: apps', () => {
  it('request_access manda al canal lateral la clave de app y nunca nombres de otra plataforma', async () => {
    const { mcp, side, done } = await boot({
      script: script({ 'resolve-app': { out: { name: 'Bloc de notas', bundleId: NOTEPAD, found: true } } })
    })
    try {
      const r = await mcp.call('request_access', { apps: ['Bloc de notas'], levels: ['full'], plan: ['escribir'] })
      expect(r.isError).toBeFalsy()
      const body = side!.requests.find((x) => x.path === '/request-access')!.body as { apps: Array<{ bundleId: string }> }
      expect(body.apps).toEqual([{ bundleId: NOTEPAD, name: 'Bloc de notas', requested: 'full' }])
    } finally {
      await done()
    }
  })

  it('si resolve-app no la encuentra, se busca entre las apps con ventana por nombre localizado o por el del ejecutable', async () => {
    const { mcp, side, done } = await boot({ script: script({ 'resolve-app': { out: { name: 'x', bundleId: '', found: false } } }) })
    try {
      await mcp.call('request_access', { apps: ['notepad'], plan: ['x'] })
      const body = side!.requests.find((x) => x.path === '/request-access')!.body as { apps: Array<{ bundleId: string }> }
      expect(body.apps.map((a) => a.bundleId)).toEqual([NOTEPAD])
    } finally {
      await done()
    }
  })

  it('una app que no existe da el mensaje de Windows', async () => {
    const { mcp, done } = await boot({ script: script({ 'resolve-app': { out: { name: 'x', bundleId: '', found: false } } }) })
    try {
      const r = await mcp.call('app_tree', { app: 'Zzqx' })
      expect(r.isError).toBe(true)
      expect(textOf(r)).toMatch(/menú Inicio/)
      expect(textOf(r)).not.toMatch(/\/Applications/)
    } finally {
      await done()
    }
  })

  it('una clave inválida de resolve-app no cuenta como encontrada', async () => {
    const { mcp, done } = await boot({
      script: script({ 'resolve-app': { out: { name: 'x', bundleId: 'com.apple.Notes', found: true } }, 'list-apps': { out: [] } })
    })
    try {
      const r = await mcp.call('app_tree', { app: 'Notes' })
      expect(r.isError).toBe(true)
      expect(cmds(mcp)).not.toContain('ax-tree')
    } finally {
      await done()
    }
  })

  it('open_application en segundo plano avisa si Windows la abrió delante', async () => {
    const { mcp, done } = await boot({
      script: script({ 'open-app-bg': { out: { ok: true, behind: false } } }),
      side: { controlMode: { mode: 'background', foreground: false } }
    })
    try {
      const r = await mcp.call('open_application', { name: 'Bloc de notas', screenshot: false })
      expect(textOf(r)).toMatch(/Aviso: la app se abrió delante/)
    } finally {
      await done()
    }
  })

  it('los códigos de salida 11 y 12 de las herramientas app_* llegan traducidos', async () => {
    const { mcp, done } = await boot({
      script: script({
        'resolve-app': { out: { name: 'Bloc de notas', bundleId: NOTEPAD, found: true } },
        'ax-tree': [{ exit: 11 }, { exit: 12 }, { exit: 7 }]
      })
    })
    try {
      const msgs: string[] = []
      for (let i = 0; i < 3; i++) msgs.push(textOf(await mcp.call('app_tree', { app: 'Bloc de notas' })))
      expect(msgs[0]).toMatch(/bloqueado o con permisos de administrador/)
      expect(msgs[1]).toMatch(/escritorio interactivo/)
      expect(msgs[2]).toBe('Esa app no está en ejecución.')
    } finally {
      await done()
    }
  })
})

describe('Windows: parada ordenada, tiempo y tamaño (procesos reales de prueba)', () => {
  it('Detener a mitad de un tecleo: STOP por stdin → el helper sale con 3 → release-input SIEMPRE después', async () => {
    let stopped = false
    const { mcp, done } = await boot({ script: script({ type: { sleepMs: 15_000 } }), side: { stopped: () => stopped } })
    try {
      const p = mcp.call('type_text', { text: 'hola', screenshot: false })
      await until(() => cmds(mcp).includes('type'))
      stopped = true
      const r = await p
      expect(r.isError).toBe(true)
      expect(textOf(r)).toBe('Control detenido por el usuario')
      await until(() => cmds(mcp).includes('release-input'))
      expect(mcp.log().some((e) => e.event === 'stop' && e.cmd === 'type')).toBe(true)
      const order = cmds(mcp)
      expect(order.indexOf('release-input')).toBeGreaterThan(order.indexOf('type'))
    } finally {
      await done()
    }
  }, 30_000)

  it('un comando que excede el tiempo del contrato aborta la acción y suelta la entrada', async () => {
    const { mcp, done } = await boot({ script: script({ cursor: { sleepMs: 8000 } }), env: { COMPUTER_HELPER_TIMEOUT_MS: '600' } })
    try {
      const r = await mcp.call('cursor_position')
      expect(r.isError).toBe(true)
      expect(textOf(r)).toMatch(/no respondió/)
      await until(() => cmds(mcp).includes('release-input'))
      expect(cmds(mcp)).toContain('release-input')
    } finally {
      await done()
    }
  }, 30_000)

  it('una salida mayor que el tope del contrato (4 MiB) aborta y suelta la entrada', async () => {
    const { mcp, done } = await boot({ script: script({ cursor: { pad: WIN_HELPER_LIMITS.maxOutputBytes + 1024 } }) })
    try {
      const r = await mcp.call('cursor_position')
      expect(r.isError).toBe(true)
      expect(textOf(r)).toMatch(/demasiada salida/)
      await until(() => cmds(mcp).includes('release-input'))
      expect(cmds(mcp)).toContain('release-input')
    } finally {
      await done()
    }
  }, 30_000)
})

// ───────────────────────────── el backend solo, con procesos y taskkill simulados ─────────────────────────────

describe('Windows: STOP → taskkill /T → release-input (dobles, relojes falsos)', () => {
  interface Spawned {
    cmd: string
    args: string[]
    child: EventEmitter & { pid: number; exitCode: number | null; signalCode: null; stdin: { write: ReturnType<typeof vi.fn> } }
    cb: (err: unknown, stdout: string, stderr: string) => void
  }
  function setup(opts: { helperIgnoresStop?: boolean } = {}): {
    backend: ReturnType<typeof createWin32Backend>
    spawned: Spawned[]
    killed: number[]
  } {
    const spawned: Spawned[] = []
    const killed: number[] = []
    let pid = 100
    const execFile = ((cmd: string, args: string[], _o: unknown, cb: Spawned['cb']) => {
      const child = Object.assign(new EventEmitter(), {
        pid: ++pid,
        exitCode: null as number | null,
        signalCode: null,
        stdin: {
          write: vi.fn((s: string) => {
            if (s === 'STOP\n' && !opts.helperIgnoresStop) setTimeout(() => finish(3), 5)
          })
        }
      })
      const finish = (code: number): void => {
        child.exitCode = code
        child.emit('exit', code)
        cb(Object.assign(new Error('x'), { code }), '', '')
      }
      Object.assign(child, { finish })
      spawned.push({ cmd, args, child: child as never, cb })
      return child
    }) as never
    const host: PlatformHost = {
      config: {
        helper: 'C:\\x\\cu-helper.exe',
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
    const backend = createWin32Backend(host, {
      execFile,
      existsSync: () => true,
      killTree: (p) => void killed.push(p),
      env: {}
    })
    return { backend, spawned, killed }
  }

  it('helper que obedece STOP: se escribe STOP, NO hace falta taskkill y después va release-input', async () => {
    vi.useFakeTimers()
    try {
      const { backend, spawned, killed } = setup()
      void backend.helperExit('type', 'hola').catch(() => undefined)
      backend.killChildren()
      expect(spawned[0].child.stdin.write).toHaveBeenCalledWith('STOP\n')
      await vi.advanceTimersByTimeAsync(10)
      expect(killed).toEqual([])
      await vi.advanceTimersByTimeAsync(50)
      const rel = spawned.find((s) => s.args.includes('release-input'))
      expect(rel).toBeTruthy()
      expect(spawned.indexOf(rel!)).toBeGreaterThan(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('helper que ignora STOP: a los 300 ms taskkill /T (por pid) y luego release-input', async () => {
    vi.useFakeTimers()
    try {
      const { backend, spawned, killed } = setup({ helperIgnoresStop: true })
      void backend.helperExit('drag', '1', '2', '3', '4').catch(() => undefined)
      const pid = spawned[0].child.pid
      backend.killChildren()
      await vi.advanceTimersByTimeAsync(299)
      expect(killed).toEqual([])
      await vi.advanceTimersByTimeAsync(2)
      expect(killed).toEqual([pid])
      expect(spawned.some((s) => s.args.includes('release-input'))).toBe(false) // aún no murió
      ;(spawned[0].child as unknown as { finish: (c: number) => void }).finish(1)
      await vi.advanceTimersByTimeAsync(10)
      expect(spawned.some((s) => s.args.includes('release-input'))).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it('sin helpers en vuelo, killChildren no hace nada (no lanza procesos de más)', () => {
    const { backend, spawned } = setup()
    backend.killChildren()
    expect(spawned).toEqual([])
  })

  it('al lanzar usa CU_HELPER_ARGV0 solo si es `node`', () => {
    for (const [argv0, expectNode] of [
      ['node', true],
      ['node.exe', true],
      ['powershell', false],
      ['', false]
    ] as const) {
      const spawned: string[] = []
      const host: PlatformHost = {
        config: {
          helper: '/h/fake.mjs',
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
      const b = createWin32Backend(host, {
        execFile: ((cmd: string) => {
          spawned.push(cmd)
          return Object.assign(new EventEmitter(), { stdin: { write: () => undefined } })
        }) as never,
        existsSync: () => true,
        env: { CU_HELPER_ARGV0: argv0 }
      })
      void b.helperExit('cursor')
      expect(spawned[0] === argv0, argv0).toBe(expectNode)
      if (!expectNode) expect(spawned[0]).toBe('/h/fake.mjs')
    }
  })
})

describe('Windows: captura con dobles (sin proceso)', () => {
  const mkHost = (over: Partial<PlatformHost['config']> = {}): PlatformHost => ({
    config: {
      helper: 'C:\\x\\cu-helper.exe',
      eventsUrl: '',
      instant: false,
      typeDelay: '',
      maxLong: 1366,
      shotDir: '',
      fakeShot: '',
      neverExclude: new Set(),
      ...over
    },
    log: () => undefined,
    tierOf: async () => null,
    mainScreen: async () => ({ width: 1, height: 1, scale: 1 }),
    sideGet: async () => ({})
  })

  it('sin canal lateral (no se sabe qué tiene acceso) NO hay captura ni se llama al helper, y se borra la salida', async () => {
    const spawned: string[] = []
    const rm = vi.fn()
    const b = createWin32Backend(mkHost(), {
      execFile: ((cmd: string) => {
        spawned.push(cmd)
        return new EventEmitter()
      }) as never,
      existsSync: () => true,
      rm,
      env: {}
    })
    await expect(b.captureScreen({ raw: 'r.png', out: 'o.jpg' })).rejects.toThrow(/No se hace la captura.*sin canal con Lazunox/)
    expect(spawned).toEqual([])
    expect(rm).toHaveBeenCalledWith('o.jpg')
  })

  it('la captura falsa de pruebas copia el archivo y mide su cabecera (sin helper)', async () => {
    const png = Buffer.alloc(33)
    Buffer.from([0x89, 0x50, 0x4e, 0x47]).copy(png)
    png.writeUInt32BE(640, 16)
    png.writeUInt32BE(480, 20)
    const copy = vi.fn()
    const b = createWin32Backend(mkHost({ fakeShot: 'fake.png' }), { copyFileSync: copy, readFile: () => png, env: {} })
    expect(await b.captureScreen({ raw: 'r', out: 'o.jpg' })).toEqual({ width: 640, height: 480 })
    expect(copy).toHaveBeenCalledWith('fake.png', 'o.jpg')
  })

  it('normalizeScreen fuerza scale 1 y conserva solo lo necesario', () => {
    const b = createWin32Backend(mkHost(), { env: {} })
    expect(b.normalizeScreen({ width: 2560, height: 1440, scale: 1.75, main: true, dpiScale: 1.75 })).toEqual({
      width: 2560,
      height: 1440,
      scale: 1,
      main: true
    })
  })
})
