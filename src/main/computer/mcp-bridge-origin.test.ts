/**
 * Modo unificado (puente de apps): lo que hace el MCP real (helper falso, canal lateral simulado) según el veredicto de main sobre el origen.
 * Sin cabecera, o con una que main no reconoce, TODO es como siempre (plan obligatorio). Con origen aislado no hay plan, pero cada acción
 * exige sesión válida de ese servidor y la concesión por app del nivel necesario (también `open_application`).
 */
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  FAKE_HELPER,
  bundleMcp,
  makePng,
  startMcp,
  startSideChannel,
  textOf,
  tmpWork,
  type McpProc,
  type SideChannel
} from '../../test/cu-mcp-kit'
import { isolatedPasteKey } from './mcp-platform'
import { WIN_ISOLATED_BLOCKED_KEYS, checkWinIsolatedCombo, isWinIsolatedExempt } from './mcp-platform-win32'
import { BRIDGE_ORIGIN_HEADER, BRIDGE_SERVER_HEADER } from '../../shared/unified-bridge'
// El ayudante falso de estas pruebas es un script sh (POSIX); en Windows no se puede ejecutar (spawn EFTYPE). Windows se cubrió en el PC real.
import { posixOnly } from '../../test/platform'

vi.setConfig({ testTimeout: 30_000 })

const work = tmpWork('lzx-mcp-bridge')
let bundle = ''
beforeAll(() => {
  bundle = bundleMcp(work.dir)
})
afterAll(() => work.cleanup())

const HDRS = { [BRIDGE_ORIGIN_HEADER]: 'secreto-de-prueba', [BRIDGE_SERVER_HEADER]: '/Users/ana/proyecto' }
const SES = 'ses_0123456789abcdef'
const ISOLATED_OK = { isolated: true, ok: true }

let seq = 0
async function boot(
  side: Parameters<typeof startSideChannel>[0],
  env: Record<string, string> = {},
  script?: Record<string, unknown>
): Promise<{ mcp: McpProc; side: SideChannel; done: () => Promise<void>; opened: () => number }> {
  const s = await startSideChannel(side)
  const mcp = await startMcp({
    bundle,
    helper: FAKE_HELPER,
    dir: join(work.dir, `w${++seq}`),
    events: s,
    ...(script ? { script } : {}),
    env: { COMPUTER_AUTO_SCREENSHOT: '0', COMPUTER_INSTANT: '1', ...env }
  })
  return {
    mcp,
    side: s,
    opened: () => mcp.calls().filter((c) => c.cmd === 'open-app' || c.cmd === 'open-app-bg').length,
    done: async () => {
      await mcp.stop()
      await s.close()
    }
  }
}

const NO_PLAN = /Todavía no hay un plan aprobado/
const paths = (s: SideChannel): string[] => s.requests.map((r) => r.path)

describe('contrato: los literales del bundle del MCP coinciden con src/shared/unified-bridge.ts', () => {
  it('cabeceras', async () => {
    const { readFileSync } = await import('node:fs')
    const src = readFileSync(join(__dirname, 'mcp-server.ts'), 'utf8')
    expect(src).toContain(`const BRIDGE_ORIGIN_HEADER = '${BRIDGE_ORIGIN_HEADER}'`)
    expect(src).toContain(`const BRIDGE_SERVER_HEADER = '${BRIDGE_SERVER_HEADER}'`)
  })
})

describe.skipIf(!posixOnly)('sin origen aislado: comportamiento de siempre', () => {
  it('sin cabeceras: exige plan y no pregunta por el puente', async () => {
    const { mcp, side, done, opened } = await boot({ planApproved: false })
    try {
      const r = await mcp.call('open_application', { name: 'Notes', lazunox_session: SES })
      expect(r.isError).toBe(true)
      expect(textOf(r)).toMatch(NO_PLAN)
      expect(paths(side)).not.toContain('/bridge-check')
      expect(opened()).toBe(0)
    } finally {
      await done()
    }
  })

  it('con cabeceras que main NO reconoce (secreto incorrecto o bandera apagada): idéntico al caso sin cabeceras', async () => {
    const { mcp, side, done, opened } = await boot({ planApproved: false, bridgeCheck: () => ({ isolated: false, ok: false }) })
    try {
      const r = await mcp.call('open_application', { name: 'Notes', lazunox_session: SES }, HDRS)
      expect(r.isError).toBe(true)
      expect(textOf(r)).toMatch(NO_PLAN)
      expect(paths(side)).toContain('/bridge-check')
      expect(opened()).toBe(0)
    } finally {
      await done()
    }
  })

  it('con plan aprobado y cabeceras ajenas: sigue funcionando como hoy', async () => {
    const { mcp, done, opened } = await boot({ planApproved: true, bridgeCheck: () => ({ isolated: false, ok: false }) })
    try {
      const r = await mcp.call('open_application', { name: 'Notes', lazunox_session: SES }, HDRS)
      expect(r.isError).not.toBe(true)
      expect(opened()).toBe(1)
    } finally {
      await done()
    }
  })

  it('con cabeceras y main caído: falla cerrado', async () => {
    const { mcp, done, opened } = await boot({ down: true })
    try {
      const r = await mcp.call('open_application', { name: 'Notes', lazunox_session: SES }, HDRS)
      expect(r.isError).toBe(true)
      expect(opened()).toBe(0)
    } finally {
      await done()
    }
  })
})

describe.skipIf(!posixOnly)('origen aislado válido', () => {
  it('reenvía las cabeceras a main (que decide) y la sesión tal cual', async () => {
    const { mcp, side, done } = await boot({ planApproved: false, bridgeCheck: () => ISOLATED_OK })
    try {
      await mcp.call('open_application', { name: 'Notes', lazunox_session: SES }, HDRS)
      const req = side.requests.find((r) => r.path === '/bridge-check')
      expect(req?.method).toBe('POST')
      expect(req?.body).toEqual({ origin: 'secreto-de-prueba', server: '/Users/ana/proyecto', session: SES })
    } finally {
      await done()
    }
  })

  it('con concesión suficiente pasa SIN plan (y no consulta plan-status)', async () => {
    const { mcp, side, done, opened } = await boot({ planApproved: false, bridgeCheck: () => ISOLATED_OK, tier: () => 'view' })
    try {
      const r = await mcp.call('open_application', { name: 'Notes', lazunox_session: SES }, HDRS)
      expect(r.isError).not.toBe(true)
      expect(textOf(r)).toContain('Abierta Notes')
      expect(opened()).toBe(1)
      expect(paths(side)).not.toContain('/plan-status')
    } finally {
      await done()
    }
  })

  it('open_application SIN concesión (o bloqueada: main responde tier null) ⇒ rechazo, no abre nada y deja auditoría', async () => {
    const { mcp, side, done, opened } = await boot({ planApproved: false, bridgeCheck: () => ISOLATED_OK, tier: () => null })
    try {
      const r = await mcp.call('open_application', { name: 'Notes', lazunox_session: SES }, HDRS)
      expect(r.isError).toBe(true)
      expect(textOf(r)).toContain('no tiene acceso concedido')
      expect(opened()).toBe(0)
      await vi.waitFor(() => expect(paths(side)).toContain('/bridge-denied'))
      const denied = side.requests.find((x) => x.path === '/bridge-denied')?.body as Record<string, unknown>
      expect(denied).toMatchObject({ tool: 'open_application', session: SES, reason: 'no-grant' })
      expect(JSON.stringify(denied)).not.toContain('secreto-de-prueba')
    } finally {
      await done()
    }
  })

  it('open_application dentro de batch también pide la concesión', async () => {
    const { mcp, done, opened } = await boot({ planApproved: false, bridgeCheck: () => ISOLATED_OK, tier: () => null })
    try {
      const r = await mcp.call('batch', { actions: [{ tool: 'open_application', args: { name: 'Notes' } }], lazunox_session: SES }, HDRS)
      expect(textOf(r)).toContain('no tiene acceso concedido')
      expect(opened()).toBe(0)
    } finally {
      await done()
    }
  })

  it('nivel insuficiente: con «solo ver» un clic se rechaza y no llega al helper', async () => {
    // Ventana de 400x300 pt (captura de 800x600 px = 2 x marco) en la pantalla principal del helper falso.
    const { mcp, side, done } = await boot(
      { planApproved: false, bridgeCheck: () => ISOLATED_OK, tier: () => 'view' },
      {},
      {
        responses: { 'windows-of': { out: [{ title: 'V', x: 0, y: 0, width: 400, height: 300 }] } }
      }
    )
    try {
      await mcp.call('screenshot', { elements: false, lazunox_session: SES }, HDRS).catch(() => undefined)
      // Sin captura de la ventana el clic con x/y ni siquiera llega a mirar el nivel: se rechaza por falta de app_screenshot.
      const blind = await mcp.call('left_click', { x: 5, y: 5, lazunox_session: SES }, HDRS)
      expect(blind.isError).toBe(true)
      expect(textOf(blind)).toContain('app_screenshot')
      const cap = await mcp.call('app_screenshot', { app: 'Notes', lazunox_session: SES }, HDRS)
      expect(cap.isError, textOf(cap)).not.toBe(true)
      const r = await mcp.call('left_click', { x: 5, y: 5, lazunox_session: SES }, HDRS)
      expect(r.isError).toBe(true)
      expect(textOf(r)).toContain('solo tiene el nivel')
      expect(mcp.calls().some((c) => c.cmd === 'click')).toBe(false)
      await vi.waitFor(() => expect(side.requests.filter((x) => x.path === '/bridge-denied').length).toBe(2))
      expect(side.requests.filter((x) => x.path === '/bridge-denied').map((x) => (x.body as { reason: string }).reason)).toEqual([
        'no-capture',
        'low-tier'
      ])
    } finally {
      await done()
    }
  })

  it.each([
    ['bad-session', 'no trae una sesión válida'],
    ['foreign-session', 'no corresponde a este servidor'],
    ['bad-server', 'No se pudo identificar']
  ])('rechazo de main «%s»: mensaje claro, la herramienta no corre', async (reason, frag) => {
    const { mcp, done, opened } = await boot({
      planApproved: true,
      bridgeCheck: () => ({ isolated: true, ok: false, reason })
    })
    try {
      const r = await mcp.call('open_application', { name: 'Notes', lazunox_session: SES }, HDRS)
      expect(r.isError).toBe(true)
      expect(textOf(r)).toContain(frag)
      expect(textOf(r)).not.toMatch(/secreto|\/Users\/ana|HTTP|bridge/i)
      expect(opened()).toBe(0)
    } finally {
      await done()
    }
  })

  it('request_access no abre tarjeta de plan: el plan se descarta; sin apps explica que no hace falta', async () => {
    const { mcp, side, done } = await boot({ planApproved: false, bridgeCheck: () => ISOLATED_OK })
    try {
      const ok = await mcp.call('request_access', { apps: ['Notes'], levels: ['click'], plan: ['uno'], lazunox_session: SES }, HDRS)
      expect(ok.isError).not.toBe(true)
      const body = side.requests.find((r) => r.path === '/request-access')?.body as { plan?: unknown; session?: string }
      expect(body.plan).toBeUndefined()
      expect(body.session).toBe(SES)
      const empty = await mcp.call('request_access', { apps: [], plan: ['uno'], lazunox_session: SES }, HDRS)
      expect(empty.isError).toBe(true)
      expect(textOf(empty)).toContain('no hace falta plan')
    } finally {
      await done()
    }
  })

  it('el kill-switch manda: parado ⇒ ni se pregunta por el puente', async () => {
    const { mcp, side, done, opened } = await boot({ stopped: () => true, bridgeCheck: () => ISOLATED_OK })
    try {
      const r = await mcp.call('open_application', { name: 'Notes', lazunox_session: SES }, HDRS)
      expect(textOf(r)).toContain('Control detenido')
      expect(paths(side)).not.toContain('/bridge-check')
      expect(opened()).toBe(0)
    } finally {
      await done()
    }
  })
})

describe.skipIf(!posixOnly)('origen aislado: nunca pantalla completa (el escritorio de Finder y otras apps no salen)', () => {
  const hasImage = (r: { content: Array<{ type: string }> }): boolean => r.content.some((c) => c.type === 'image')
  const NOTES = (k: string): 'view' | null => (k.length ? 'view' : null)

  it('screenshot con concesión de Notas ⇒ rechazo claro, sin imagen y sin captura en el helper', async () => {
    const { mcp, done } = await boot({ planApproved: false, bridgeCheck: () => ISOLATED_OK, tier: NOTES })
    try {
      const r = await mcp.call('screenshot', { lazunox_session: SES }, HDRS)
      expect(r.isError).toBe(true)
      expect(textOf(r)).toContain('app_screenshot')
      expect(hasImage(r)).toBe(false)
      expect(mcp.calls().some((c) => /screenshot|screencapture|capture/.test(c.cmd))).toBe(false)
    } finally {
      await done()
    }
  })

  it('zoom ⇒ rechazo, aunque otra llamada no aislada haya capturado antes', async () => {
    const { mcp, done } = await boot({ planApproved: false, bridgeCheck: () => ISOLATED_OK, tier: NOTES })
    try {
      const r = await mcp.call('zoom', { x: 0, y: 0, width: 10, height: 10, lazunox_session: SES }, HDRS)
      expect(r.isError).toBe(true)
      expect(textOf(r)).toContain('app_screenshot')
      expect(hasImage(r)).toBe(false)
    } finally {
      await done()
    }
  })

  it('request_access aprobado y open_application (capturas automáticas encendidas) ⇒ sin imagen', async () => {
    const { mcp, done } = await boot(
      { planApproved: false, bridgeCheck: () => ISOLATED_OK, tier: NOTES },
      { COMPUTER_AUTO_SCREENSHOT: '1' }
    )
    try {
      const a = await mcp.call('request_access', { apps: ['Notes'], levels: ['view'], lazunox_session: SES }, HDRS)
      expect(a.isError).not.toBe(true)
      expect(hasImage(a)).toBe(false)
      const o = await mcp.call('open_application', { name: 'Notes', lazunox_session: SES }, HDRS)
      expect(o.isError).not.toBe(true)
      expect(hasImage(o)).toBe(false)
      expect(mcp.calls().some((c) => /screenshot|screencapture|capture/.test(c.cmd) && !/app/.test(c.cmd))).toBe(false)
    } finally {
      await done()
    }
  })

  it('control: sin origen aislado (plan aprobado, Control total) la captura completa sigue igual', async () => {
    const { mcp, done } = await boot({ planApproved: true, bridgeCheck: () => ({ isolated: false, ok: false }) })
    try {
      const r = await mcp.call('screenshot', { elements: false, lazunox_session: SES }, HDRS)
      expect(r.isError).not.toBe(true)
      expect(hasImage(r)).toBe(true)
    } finally {
      await done()
    }
  })
})

describe.skipIf(!posixOnly)('origen aislado en Windows: teclas, exentas y captura (helper falso)', () => {
  const k = (path: string, pub = 'Microsoft Windows'): string => `exe:${path.toLowerCase()}|pub:${pub.toLowerCase()}`
  const NOTEPAD = k('C:\\Windows\\System32\\notepad.exe')
  const LAZUNOX = k('C:\\Users\\Ana\\AppData\\Local\\Programs\\Lazunox\\Lazunox.exe', 'Bentec')
  const win32Script = {
    responses: {
      version: { out: { protocol: 1, helper: 'fake-1.0.0', platform: 'win32' } },
      session: { out: { interactive: true, secureDesktop: false, elevatedTarget: false } },
      screens: { out: [{ width: 2560, height: 1440, scale: 1.5, dpiScale: 1.5, x: 0, y: 0, main: true }] },
      frontmost: { out: { name: 'Bloc de notas', bundleId: NOTEPAD, pid: 2 } },
      'app-at': { out: { name: 'Bloc de notas', bundleId: NOTEPAD, pid: 2 } },
      'list-apps': { out: [{ name: 'Bloc de notas', appKey: NOTEPAD, pid: 2 }] }
    }
  }
  async function bootWin(): Promise<{ mcp: McpProc; done: () => Promise<void> }> {
    const s = await startSideChannel({
      planApproved: false,
      bridgeCheck: () => ISOLATED_OK,
      tier: (b) => (b === NOTEPAD ? 'full' : null)
    })
    const mcp = await startMcp({
      bundle,
      helper: FAKE_HELPER,
      dir: join(work.dir, `w${++seq}`),
      platform: 'win32',
      events: s,
      script: win32Script,
      env: { COMPUTER_BACKEND: 'win32', CU_HELPER_ARGV0: 'node', COMPUTER_AUTO_SCREENSHOT: '0', COMPUTER_INSTANT: '1' }
    })
    return {
      mcp,
      done: async () => {
        await mcp.stop()
        await s.close()
      }
    }
  }
  const sent = (m: McpProc): string[] =>
    m
      .calls()
      .filter((c) => c.cmd === 'key')
      .map((c) => c.args.join(' '))

  it.each(['alt+tab', 'win+d', 'ctrl+shift+esc', 'alt+f4', 'ctrl+esc', 'alt+space', 'ctrl+alt+del', 'alt+shift+tab', 'win+e'])(
    'key %s ⇒ rechazada y no llega al helper',
    async (combo) => {
      const { mcp, done } = await bootWin()
      try {
        const r = await mcp.call('key', { keys: combo, lazunox_session: SES }, HDRS)
        expect(r.isError).toBe(true)
        expect(textOf(r)).toMatch(/en este modo no se pulsa/)
        expect(sent(mcp)).toEqual([])
      } finally {
        await done()
      }
    }
  )

  it('key: una sola combinación por llamada', async () => {
    const { mcp, done } = await bootWin()
    try {
      const r = await mcp.call('key', { keys: 'ctrl+a ctrl+c', lazunox_session: SES }, HDRS)
      expect(r.isError).toBe(true)
      expect(textOf(r)).toMatch(/UNA combinación/)
      expect(sent(mcp)).toEqual([])
    } finally {
      await done()
    }
  })

  it('key permitida (ctrl+a) llega al helper', async () => {
    const { mcp, done } = await bootWin()
    try {
      const r = await mcp.call('key', { keys: 'ctrl+a', lazunox_session: SES }, HDRS)
      expect(r.isError).not.toBe(true)
      expect(sent(mcp).join('|')).toContain('ctrl+a')
    } finally {
      await done()
    }
  })

  it('lista y veredictos (unidad): quitar alt+tab de la lista haría fallar esto', () => {
    expect(WIN_ISOLATED_BLOCKED_KEYS).toContain('alt+tab')
    expect(checkWinIsolatedCombo('alt+tab')).toBe('blocked')
    expect(checkWinIsolatedCombo('ctrl+alt+tab')).toBe('blocked')
    expect(checkWinIsolatedCombo('win+d')).toBe('blocked')
    expect(checkWinIsolatedCombo('ctrl+shift+esc')).toBe('blocked')
    expect(checkWinIsolatedCombo('alt+f7')).toBe('blocked')
    expect(checkWinIsolatedCombo('cmd+a')).toBe('unknown')
    expect(checkWinIsolatedCombo('ctrl+tab')).toBe('ok')
    expect(checkWinIsolatedCombo('ctrl+v')).toBe('ok')
    expect(checkWinIsolatedCombo('f5')).toBe('ok')
  })

  it('atajo de pegar fijo por plataforma: ctrl+v en win32, cmd+v en darwin', () => {
    expect(isolatedPasteKey('win32')).toBe('ctrl+v')
    expect(isolatedPasteKey('darwin')).toBe('cmd+v')
  })

  it('apps exentas de Windows (Lazunox y el shell sí; explorer solo con concesión; Bloc de notas no)', () => {
    for (const e of [
      'lazunox.exe',
      'shellexperiencehost.exe',
      'searchhost.exe',
      'searchapp.exe',
      'startmenuexperiencehost.exe',
      'lockapp.exe'
    ]) {
      expect(isWinIsolatedExempt(k(`C:\\Windows\\SystemApps\\${e}`))).toBe(true)
    }
    expect(isWinIsolatedExempt(LAZUNOX)).toBe(true)
    expect(isWinIsolatedExempt(k('C:\\Windows\\explorer.exe'))).toBe(false)
    expect(isWinIsolatedExempt(NOTEPAD)).toBe(false)
    expect(isWinIsolatedExempt('basura')).toBe(true)
    expect(isWinIsolatedExempt('aumid:microsoft.windows.startmenuexperiencehost_cw5n1h2txyewy!app')).toBe(true)
  })

  it('actuar sobre Lazunox (exenta) en origen aislado ⇒ rechazo aunque main diga que hay concesión', async () => {
    const s = await startSideChannel({ planApproved: false, bridgeCheck: () => ISOLATED_OK, tier: () => 'full' })
    const mcp = await startMcp({
      bundle,
      helper: FAKE_HELPER,
      dir: join(work.dir, `w${++seq}`),
      platform: 'win32',
      events: s,
      script: { responses: { ...win32Script.responses, frontmost: { out: { name: 'Lazunox', bundleId: LAZUNOX, pid: 1 } } } },
      env: { COMPUTER_BACKEND: 'win32', CU_HELPER_ARGV0: 'node', COMPUTER_AUTO_SCREENSHOT: '0', COMPUTER_INSTANT: '1' }
    })
    try {
      const r = await mcp.call('key', { keys: 'ctrl+a', lazunox_session: SES }, HDRS)
      expect(r.isError).toBe(true)
      expect(textOf(r)).toMatch(/propia Lazunox/)
      expect(sent(mcp)).toEqual([])
    } finally {
      await mcp.stop()
      await s.close()
    }
  })

  it('captura de pantalla completa en origen aislado ⇒ rechazada, sin imagen ni captura en el helper', async () => {
    const { mcp, done } = await bootWin()
    try {
      const r = await mcp.call('screenshot', { lazunox_session: SES }, HDRS)
      expect(r.isError).toBe(true)
      expect(r.content.some((c) => c.type === 'image')).toBe(false)
      expect(mcp.calls().some((c) => c.cmd === 'screenshot')).toBe(false)
    } finally {
      await done()
    }
  })

  it('app_screenshot de la app concedida (una sola ventana) sigue valiendo', async () => {
    const { mcp, done } = await bootWin()
    try {
      const r = await mcp.call('app_screenshot', { app: 'notepad', lazunox_session: SES }, HDRS)
      if (r.isError) throw new Error(textOf(r))
      expect(r.content.some((c) => c.type === 'image')).toBe(true)
      expect(mcp.calls().some((c) => c.cmd === 'window-shot')).toBe(true)
    } finally {
      await done()
    }
  })
})

// ───────────────────────────── clic en píxeles de app_screenshot (pantalla secundaria) ─────────────────────────────

describe.skipIf(!posixOnly)('origen aislado: el clic va en píxeles de la última app_screenshot (cualquier monitor)', () => {
  type R = { x: number; y: number; width: number; height: number }
  const rect = (x: number, y: number, width: number, height: number): R => ({ x, y, width, height })
  const NOTES_APP = { name: 'Notes', bundleId: 'com.apple.Notes', pid: 100 }
  const SLACK_APP = { name: 'Slack', bundleId: 'com.tinyspeck.slackmacgap', pid: 101 }
  const MAIN = { width: 1512, height: 982, scale: 2, x: 0, y: 0, main: true }
  const LEFT = { width: 1920, height: 1080, scale: 1, x: -1920, y: 0 }
  const RIGHT_UP = { width: 1920, height: 1080, scale: 1, x: 1512, y: -200 }
  const SES2 = 'ses_fedcba9876543210'

  interface Setup {
    screens?: unknown[]
    /** Respuesta(s) de `windows-of` (una lista de respuestas se consume una por llamada). */
    windowsOf?: unknown
    shot?: Record<string, unknown>
    image?: Buffer
    sips?: { width: number; height: number }
    at?: unknown
    tier?: (b: string) => 'view' | 'click' | 'full' | null
    env?: Record<string, string>
    elements?: unknown[]
  }

  /** macOS: ventana de 400x300 pt (captura retina de 800x600 px) en `frame`; por defecto, en un monitor a la izquierda. */
  async function bootMac(o: Setup = {}): Promise<{ mcp: McpProc; side: SideChannel; done: () => Promise<void> }> {
    const frame = rect(-1500, 100, 400, 300)
    const s = await startSideChannel({ planApproved: false, bridgeCheck: () => ISOLATED_OK, tier: o.tier ?? (() => 'full') })
    const mcp = await startMcp({
      bundle,
      helper: FAKE_HELPER,
      dir: join(work.dir, `w${++seq}`),
      events: s,
      image: o.image ?? makePng(800, 600),
      sipsSize: o.sips ?? { width: 800, height: 600 },
      script: {
        responses: {
          screens: { out: o.screens ?? [MAIN, LEFT] },
          'windows-of': o.windowsOf ?? { out: [{ title: 'Ventana', ...frame }] },
          'window-shot': { writeImage: true, out: o.shot ?? { ok: true, width: 800, height: 600, title: 'Ventana' } },
          frontmost: { out: NOTES_APP },
          'app-at': { out: o.at ?? NOTES_APP },
          'resolve-app': { out: { ...NOTES_APP, found: true } },
          ...(o.elements ? { 'find-elements': { out: o.elements } } : {})
        }
      },
      env: { COMPUTER_AUTO_SCREENSHOT: '0', COMPUTER_INSTANT: '1', ...(o.env ?? {}) }
    })
    return {
      mcp,
      side: s,
      done: async () => {
        await mcp.stop()
        await s.close()
      }
    }
  }

  const clicks = (m: McpProc): string[][] =>
    m
      .calls()
      .filter((c) => c.cmd === 'click')
      .map((c) => c.args)
  const moves = (m: McpProc): string[][] =>
    m
      .calls()
      .filter((c) => c.cmd === 'move')
      .map((c) => c.args)
  const drags = (m: McpProc): string[][] =>
    m
      .calls()
      .filter((c) => c.cmd === 'drag')
      .map((c) => c.args)
  const scrolls = (m: McpProc): string[][] =>
    m
      .calls()
      .filter((c) => c.cmd === 'scroll')
      .map((c) => c.args)
  const anyInput = (m: McpProc): boolean => m.calls().some((c) => ['click', 'move', 'drag', 'scroll'].includes(c.cmd))
  const reasons = (s: SideChannel): string[] =>
    s.requests.filter((r) => r.path === '/bridge-denied').map((r) => (r.body as { reason: string }).reason)

  /** Captura la ventana y devuelve el tamaño REAL de la imagen que informa el MCP (en el Mac, `sips` real la reescala a 1366 px de lado largo). */
  async function shot(m: McpProc, session = SES, app = 'Notes'): Promise<{ text: string; w: number; h: number }> {
    const r = await m.call('app_screenshot', { app, lazunox_session: session }, HDRS)
    if (r.isError) throw new Error(textOf(r))
    const text = textOf(r)
    const dims = /(\d+)x(\d+) px/.exec(text)
    return { text, w: Number(dims?.[1] ?? 0), h: Number(dims?.[2] ?? 0) }
  }

  /** Compara llamadas del helper con lo esperado; los números admiten ±0,05 (el MCP redondea a 2 decimales). */
  function expectCalls(got: string[][], want: Array<Array<number | string>>): void {
    expect(got.length).toBe(want.length)
    got.forEach((g, i) => {
      expect(g.length).toBe(want[i].length)
      g.forEach((v, j) => {
        const w = want[i][j]
        if (typeof w === 'number') expect(Math.abs(Number(v) - w)).toBeLessThanOrEqual(0.05)
        else expect(v).toBe(w)
      })
    })
  }

  it('monitor a la IZQUIERDA (origen negativo): el clic llega al helper con el punto global de la ventana', async () => {
    const { mcp, done } = await bootMac()
    try {
      const { text, w, h } = await shot(mcp)
      expect(text).toContain('de ESTA imagen')
      expect(text).toContain('90 s')
      expect(text).not.toMatch(/-1500|-1100/) // el rectángulo global no se escribe para el modelo
      const r = await mcp.call('left_click', { x: w / 2, y: h / 2, lazunox_session: SES }, HDRS)
      expect(r.isError, textOf(r)).not.toBe(true)
      // El centro de la imagen es el centro de la ventana: (-1500 + 200, 100 + 150).
      expectCalls(clicks(mcp), [[-1300, 250, 'left', '1']])
    } finally {
      await done()
    }
  })

  it('monitor ARRIBA a la derecha (x > ancho de la principal, y negativa): doble clic, clic derecho, mover y desplazar', async () => {
    const { mcp, done } = await bootMac({
      screens: [MAIN, RIGHT_UP],
      windowsOf: { out: [{ title: 'V', ...rect(1600, -100, 400, 300) }] }
    })
    try {
      const { w, h } = await shot(mcp)
      expect((await mcp.call('double_click', { x: w / 2, y: h / 3, lazunox_session: SES }, HDRS)).isError).not.toBe(true)
      expect((await mcp.call('right_click', { x: 0, y: 0, lazunox_session: SES }, HDRS)).isError).not.toBe(true)
      expect((await mcp.call('mouse_move', { x: w * 0.75, y: h * 0.75, lazunox_session: SES }, HDRS)).isError).not.toBe(true)
      expect((await mcp.call('scroll', { x: w / 2, y: h / 2, direction: 'down', amount: 3, lazunox_session: SES }, HDRS)).isError).not.toBe(
        true
      )
      expectCalls(clicks(mcp), [
        [1800, -100 + 100, 'left', '2'],
        [1600, -100, 'right', '1']
      ])
      expectCalls(moves(mcp), [[1600 + 300, -100 + 225]])
      expectCalls(scrolls(mcp), [[1800, 50, '0', '3']])
    } finally {
      await done()
    }
  })

  it('escala: JPEG reducido por sips y monitor a escala 1 junto a una principal a escala 2 (el punto sale de la imagen REAL, no del PNG)', async () => {
    const { mcp, done } = await bootMac({
      screens: [MAIN, LEFT],
      windowsOf: { out: [{ title: 'Grande', ...rect(-1700, 50, 1400, 900) }] },
      shot: { ok: true, width: 2800, height: 1800, title: 'Grande' },
      image: makePng(2800, 1800),
      sips: { width: 1366, height: 878 }
    })
    try {
      const { w, h } = await shot(mcp)
      expect(w).toBeGreaterThan(0)
      expect(w).toBeLessThanOrEqual(1366)
      expect(w).toBeLessThan(2800)
      const r = await mcp.call('left_click', { x: w / 2, y: h / 2, lazunox_session: SES }, HDRS)
      expect(r.isError, textOf(r)).not.toBe(true)
      const [cx, cy] = clicks(mcp)[0].map(Number)
      expect(Math.abs(cx - (-1700 + 700))).toBeLessThanOrEqual(1)
      expect(Math.abs(cy - (50 + 450))).toBeLessThanOrEqual(1)
    } finally {
      await done()
    }
  })

  it('drag con los dos extremos en la ventana capturada llega al helper', async () => {
    const { mcp, done } = await bootMac()
    try {
      const { w, h } = await shot(mcp)
      const r = await mcp.call('drag', { start_x: 0, start_y: 0, end_x: w / 2, end_y: h / 2, lazunox_session: SES }, HDRS)
      expect(r.isError, textOf(r)).not.toBe(true)
      expectCalls(drags(mcp), [[-1500, 100, -1300, 250]])
    } finally {
      await done()
    }
  })

  describe('rechazos: ninguna llamada de ratón llega al helper', () => {
    it('sin app_screenshot previa el clic con x/y FALLA CERRADO (aunque la app esté concedida y al frente)', async () => {
      const { mcp, side, done } = await boot({ planApproved: false, bridgeCheck: () => ISOLATED_OK, tier: () => 'full' })
      try {
        for (const [tool, args] of [
          ['left_click', { x: 10, y: 10 }],
          ['mouse_move', { x: 10, y: 10 }],
          ['scroll', { x: 10, y: 10, direction: 'down' }],
          ['drag', { start_x: 1, start_y: 1, end_x: 5, end_y: 5 }]
        ] as const) {
          const r = await mcp.call(tool, { ...args, lazunox_session: SES }, HDRS)
          expect(r.isError, tool).toBe(true)
          expect(textOf(r)).toContain('app_screenshot')
        }
        expect(anyInput(mcp)).toBe(false)
        await vi.waitFor(() => expect(side.requests.some((x) => x.path === '/bridge-denied')).toBe(true))
        expect(reasons(side)).toContain('no-capture')
      } finally {
        await done()
      }
    })

    it('captura de OTRA sesión: la sesión hermana no puede usarla', async () => {
      const { mcp, side, done } = await bootMac()
      try {
        await shot(mcp, SES)
        const r = await mcp.call('left_click', { x: 400, y: 300, lazunox_session: SES2 }, HDRS)
        expect(r.isError).toBe(true)
        expect(textOf(r)).toContain('app_screenshot')
        expect(anyInput(mcp)).toBe(false)
        await vi.waitFor(() => expect(reasons(side)).toContain('no-capture'))
      } finally {
        await done()
      }
    })

    it('captura caducada: pasado el plazo hay que capturar de nuevo (plazo acortado por la variable de pruebas; nunca puede alargarse)', async () => {
      const { mcp, side, done } = await bootMac({ env: { COMPUTER_WINDOW_CTX_TTL_MS: '400' } })
      try {
        await shot(mcp)
        await new Promise((r) => setTimeout(r, 700))
        const r = await mcp.call('left_click', { x: 400, y: 300, lazunox_session: SES }, HDRS)
        expect(r.isError).toBe(true)
        expect(textOf(r)).toContain('caducó')
        expect(anyInput(mcp)).toBe(false)
        await vi.waitFor(() => expect(reasons(side)).toContain('capture-expired'))
        await shot(mcp)
        expect((await mcp.call('left_click', { x: 400, y: 300, lazunox_session: SES }, HDRS)).isError).not.toBe(true)
      } finally {
        await done()
      }
      const { readFileSync } = await import('node:fs')
      expect(readFileSync(join(__dirname, 'mcp-server.ts'), 'utf8')).toMatch(/Math\.min\(90_000,/)
    })

    it('píxeles fuera de la imagen (negativos o mayores que su tamaño)', async () => {
      const { mcp, side, done } = await bootMac()
      try {
        const { w, h } = await shot(mcp)
        for (const [x, y] of [
          [-1, 10],
          [10, -1],
          [w + 1, 10],
          [10, h + 1],
          [5000, 5000]
        ]) {
          const r = await mcp.call('left_click', { x, y, lazunox_session: SES }, HDRS)
          expect(r.isError, `${x},${y}`).toBe(true)
          expect(textOf(r)).toContain('fuera de la imagen')
        }
        expect(anyInput(mcp)).toBe(false)
        await vi.waitFor(() => expect(reasons(side)).toContain('outside-window'))
      } finally {
        await done()
      }
    })

    it('punto dentro de la ventana pero fuera de TODO monitor (ventana a medio salir de la pantalla)', async () => {
      const { mcp, side, done } = await bootMac({
        screens: [MAIN],
        windowsOf: { out: [{ title: 'V', ...rect(1400, 100, 400, 300) }] } // 1400..1800 pt, la principal termina en 1512
      })
      try {
        const { w, h } = await shot(mcp)
        const off = await mcp.call('left_click', { x: w * 0.875, y: h / 2, lazunox_session: SES }, HDRS) // x = 1750 pt
        expect(off.isError).toBe(true)
        expect(textOf(off)).toContain('ninguna pantalla')
        expect(anyInput(mcp)).toBe(false)
        await vi.waitFor(() => expect(reasons(side)).toContain('off-screen'))
        // Control: la parte de la ventana que SÍ está en la pantalla funciona.
        expect((await mcp.call('left_click', { x: w * 0.125, y: h / 2, lazunox_session: SES }, HDRS)).isError).not.toBe(true)
        expectCalls(clicks(mcp), [[1450, 250, 'left', '1']])
      } finally {
        await done()
      }
    })

    it('la ventana se movió entre la captura y el clic (windows-of con otro marco) ⇒ no se actúa y se pide captura nueva', async () => {
      const { mcp, side, done } = await bootMac({
        windowsOf: [{ out: [{ title: 'V', ...rect(-1500, 100, 400, 300) }] }, { out: [{ title: 'V', ...rect(-1400, 100, 400, 300) }] }]
      })
      try {
        await shot(mcp)
        const r = await mcp.call('left_click', { x: 400, y: 300, lazunox_session: SES }, HDRS)
        expect(r.isError).toBe(true)
        expect(textOf(r)).toContain('se movió')
        expect(anyInput(mcp)).toBe(false)
        await vi.waitFor(() => expect(reasons(side)).toContain('window-moved'))
        // La captura anterior ya no sirve.
        expect((await mcp.call('left_click', { x: 400, y: 300, lazunox_session: SES }, HDRS)).isError).toBe(true)
        expect(anyInput(mcp)).toBe(false)
      } finally {
        await done()
      }
    })

    it('la ventana se cerró (windows-of vacío) ⇒ no se actúa', async () => {
      const { mcp, done } = await bootMac({ windowsOf: [{ out: [{ title: 'V', ...rect(-1500, 100, 400, 300) }] }, { out: [] }] })
      try {
        await shot(mcp)
        const r = await mcp.call('mouse_move', { x: 400, y: 300, lazunox_session: SES }, HDRS)
        expect(r.isError).toBe(true)
        expect(anyInput(mcp)).toBe(false)
      } finally {
        await done()
      }
    })

    it('otra app CONCEDIDA queda bajo el punto (una ventana la tapa): se rechaza aunque requireTier lo viera bien', async () => {
      // 1.ª lectura de app-at (requireTier): Notes; 2.ª (comprobación de la app capturada): Slack.
      const s = await startSideChannel({ planApproved: false, bridgeCheck: () => ISOLATED_OK, tier: () => 'full' })
      const m = await startMcp({
        bundle,
        helper: FAKE_HELPER,
        dir: join(work.dir, `w${++seq}`),
        events: s,
        image: makePng(800, 600),
        sipsSize: { width: 800, height: 600 },
        script: {
          responses: {
            screens: { out: [MAIN, LEFT] },
            'windows-of': { out: [{ title: 'V', ...rect(-1500, 100, 400, 300) }] },
            'window-shot': { writeImage: true, out: { ok: true, width: 800, height: 600 } },
            frontmost: { out: NOTES_APP },
            'app-at': [{ out: NOTES_APP }, { out: SLACK_APP }],
            'resolve-app': { out: { ...NOTES_APP, found: true } }
          }
        },
        env: { COMPUTER_AUTO_SCREENSHOT: '0', COMPUTER_INSTANT: '1' }
      })
      try {
        await shot(m)
        const r = await m.call('left_click', { x: 400, y: 300, lazunox_session: SES }, HDRS)
        expect(r.isError).toBe(true)
        expect(textOf(r)).toContain('no está Notes')
        expect(anyInput(m)).toBe(false)
        await vi.waitFor(() => expect(reasons(s)).toContain('outside-window'))
      } finally {
        await m.stop()
        await s.close()
      }
    })

    it('otra app SIN concesión bajo el punto ⇒ rechazo por nivel (requireTier sigue vigente)', async () => {
      const { mcp, done } = await bootMac({
        at: SLACK_APP,
        tier: (b) => (b === NOTES_APP.bundleId ? 'full' : null)
      })
      try {
        await shot(mcp)
        const r = await mcp.call('left_click', { x: 400, y: 300, lazunox_session: SES }, HDRS)
        expect(r.isError).toBe(true)
        expect(textOf(r)).toContain('no tiene acceso concedido')
        expect(anyInput(mcp)).toBe(false)
      } finally {
        await done()
      }
    })

    it('drag con un extremo fuera de la imagen/ventana ⇒ no se arrastra', async () => {
      const { mcp, done } = await bootMac()
      try {
        const { w, h } = await shot(mcp)
        for (const a of [
          { start_x: 100, start_y: 100, end_x: w + 100, end_y: 100 },
          { start_x: -5, start_y: 100, end_x: 100, end_y: 100 },
          { start_x: 100, start_y: 100, end_x: 100, end_y: h + 1 }
        ]) {
          const r = await mcp.call('drag', { ...a, lazunox_session: SES }, HDRS)
          expect(r.isError, JSON.stringify(a)).toBe(true)
        }
        expect(anyInput(mcp)).toBe(false)
      } finally {
        await done()
      }
    })

    it('drag: un extremo bajo OTRA app (el escritorio u otra ventana) ⇒ no se arrastra', async () => {
      const s = await startSideChannel({ planApproved: false, bridgeCheck: () => ISOLATED_OK, tier: () => 'full' })
      const m = await startMcp({
        bundle,
        helper: FAKE_HELPER,
        dir: join(work.dir, `w${++seq}`),
        events: s,
        image: makePng(800, 600),
        sipsSize: { width: 800, height: 600 },
        script: {
          responses: {
            screens: { out: [MAIN, LEFT] },
            'windows-of': { out: [{ title: 'V', ...rect(-1500, 100, 400, 300) }] },
            'window-shot': { writeImage: true, out: { ok: true, width: 800, height: 600 } },
            frontmost: { out: NOTES_APP },
            // requireTier('full', s) y requireTier('full', e) ven Notes; la comprobación del extremo de inicio también; la del final, otra app.
            'app-at': [{ out: NOTES_APP }, { out: NOTES_APP }, { out: NOTES_APP }, { out: SLACK_APP }],
            'resolve-app': { out: { ...NOTES_APP, found: true } }
          }
        },
        env: { COMPUTER_AUTO_SCREENSHOT: '0', COMPUTER_INSTANT: '1' }
      })
      try {
        const { w, h } = await shot(m)
        const r = await m.call('drag', { start_x: 10, start_y: 10, end_x: w / 2, end_y: h / 2, lazunox_session: SES }, HDRS)
        expect(r.isError).toBe(true)
        expect(anyInput(m)).toBe(false)
      } finally {
        await m.stop()
        await s.close()
      }
    })

    it('comprobación cruzada de tamaño fallida (macOS): la captura sirve para mirar, no para clics; y borra la anterior', async () => {
      const { mcp, done } = await bootMac({
        windowsOf: { out: [{ title: 'V', ...rect(-1500, 100, 500, 300) }] } // el PNG de 800 px no cuadra con 2 × 500
      })
      try {
        const { text } = await shot(mcp)
        expect(text).toContain('No se pudo ubicar la ventana')
        expect(text).toContain('para mirar')
        const r = await mcp.call('left_click', { x: 100, y: 100, lazunox_session: SES }, HDRS)
        expect(r.isError).toBe(true)
        expect(textOf(r)).toContain('app_screenshot')
        expect(anyInput(mcp)).toBe(false)
      } finally {
        await done()
      }
    })

    it('una captura que no se puede ubicar BORRA la anterior (no se sigue clicando con una vieja)', async () => {
      const { mcp, done } = await bootMac({
        windowsOf: [
          { out: [{ title: 'V', ...rect(-1500, 100, 400, 300) }] }, // 1.ª captura: cuadra
          { out: [{ title: 'V', ...rect(-1500, 100, 500, 300) }] } // 2.ª: no cuadra
        ]
      })
      try {
        await shot(mcp)
        await shot(mcp)
        const r = await mcp.call('left_click', { x: 100, y: 100, lazunox_session: SES }, HDRS)
        expect(r.isError).toBe(true)
        expect(anyInput(mcp)).toBe(false)
      } finally {
        await done()
      }
    })

    it('element: N no existe en origen aislado (no hay lista) y lleva a x/y sobre app_screenshot', async () => {
      const { mcp, done } = await bootMac()
      try {
        await shot(mcp)
        const r = await mcp.call('left_click', { element: 1, lazunox_session: SES }, HDRS)
        expect(r.isError).toBe(true)
        expect(textOf(r)).toContain('app_screenshot')
        expect(anyInput(mcp)).toBe(false)
      } finally {
        await done()
      }
    })

    it('nivel «solo ver» con captura vigente: sigue rechazando el clic (requireTier)', async () => {
      const { mcp, side, done } = await bootMac({ tier: () => 'view' })
      try {
        await shot(mcp)
        const r = await mcp.call('left_click', { x: 400, y: 300, lazunox_session: SES }, HDRS)
        expect(r.isError).toBe(true)
        expect(textOf(r)).toContain('solo tiene el nivel')
        expect(anyInput(mcp)).toBe(false)
        await vi.waitFor(() => expect(reasons(side)).toContain('low-tier'))
      } finally {
        await done()
      }
    })

    it('app exenta al frente (Lazunox) con captura vigente: sigue rechazada', async () => {
      const s = await startSideChannel({ planApproved: false, bridgeCheck: () => ISOLATED_OK, tier: () => 'full' })
      const m = await startMcp({
        bundle,
        helper: FAKE_HELPER,
        dir: join(work.dir, `w${++seq}`),
        events: s,
        image: makePng(800, 600),
        sipsSize: { width: 800, height: 600 },
        script: {
          responses: {
            screens: { out: [MAIN, LEFT] },
            'windows-of': { out: [{ title: 'V', ...rect(-1500, 100, 400, 300) }] },
            'window-shot': { writeImage: true, out: { ok: true, width: 800, height: 600 } },
            frontmost: { out: { name: 'Spotlight', bundleId: 'com.apple.Spotlight', pid: 3 } },
            'app-at': { out: NOTES_APP },
            'resolve-app': { out: { ...NOTES_APP, found: true } }
          }
        },
        env: { COMPUTER_AUTO_SCREENSHOT: '0', COMPUTER_INSTANT: '1' }
      })
      try {
        await shot(m)
        const r = await m.call('left_click', { x: 400, y: 300, lazunox_session: SES }, HDRS)
        expect(r.isError).toBe(true)
        expect(anyInput(m)).toBe(false)
      } finally {
        await m.stop()
        await s.close()
      }
    })
  })

  describe('find_element / list_elements en origen aislado', () => {
    const EL = {
      role: 'AXButton',
      title: 'Reproducir',
      enabled: true,
      x: 0,
      y: 0,
      width: 40,
      height: 20,
      screenPoint: { x: -1300, y: 250 }
    }
    const OUT = { ...EL, title: 'Afuera', screenPoint: { x: -1000, y: 250 } }

    it('con captura: los puntos van en píxeles de la app_screenshot y lo que cae fuera de la ventana se marca', async () => {
      const { mcp, done } = await bootMac({ elements: [EL, OUT] })
      try {
        const { w, h } = await shot(mcp)
        const r = await mcp.call('list_elements', { appHint: 'Notes', lazunox_session: SES }, HDRS)
        expect(r.isError, textOf(r)).not.toBe(true)
        const t = textOf(r)
        // «Reproducir» (-1300, 250) es el centro de la ventana; «Afuera» (-1000, 250) cae a la derecha de ella (marco -1500..-1100).
        expect(t).toContain(`"Reproducir" en (${Math.round(w / 2)}, ${Math.round(h / 2)}) px`)
        expect(t).toMatch(
          new RegExp(`"Afuera" en \\(${Math.round((500 * w) / 400)}, ${Math.round(h / 2)}\\) px.*fuera de la ventana capturada`)
        )
      } finally {
        await done()
      }
    })

    it('sin captura: sin coordenadas y una línea que pide app_screenshot', async () => {
      const { mcp, done } = await bootMac({ elements: [EL] })
      try {
        const r = await mcp.call('list_elements', { appHint: 'Notes', lazunox_session: SES }, HDRS)
        expect(r.isError, textOf(r)).not.toBe(true)
        const t = textOf(r)
        expect(t).toContain('sin coordenadas')
        expect(t).toContain('app_screenshot')
        expect(t).not.toMatch(/-1300|\(\d+, \d+\) px/)
      } finally {
        await done()
      }
    })
  })

  describe('Windows (rect ≠ frame): la conversión usa rect y el límite usa frame', () => {
    const NOTEPAD = 'exe:c:\\windows\\system32\\notepad.exe|pub:microsoft windows'
    // rect (imagen) con 8 px de borde invisible alrededor del marco visible; el JPEG final mide la mitad.
    const RECT = rect(-1908, 92, 816, 616)
    const FRAME = rect(-1900, 100, 800, 600)

    async function bootWinShot(o: { windowsOf?: unknown; at?: unknown } = {}): Promise<{ mcp: McpProc; done: () => Promise<void> }> {
      const s = await startSideChannel({
        planApproved: false,
        bridgeCheck: () => ISOLATED_OK,
        tier: (b) => (b === NOTEPAD ? 'full' : null)
      })
      const mcp = await startMcp({
        bundle,
        helper: FAKE_HELPER,
        dir: join(work.dir, `w${++seq}`),
        platform: 'win32',
        events: s,
        script: {
          responses: {
            version: { out: { protocol: 1, helper: 'fake-1.0.0', platform: 'win32' } },
            session: { out: { interactive: true, secureDesktop: false, elevatedTarget: false } },
            screens: {
              out: [
                { width: 2560, height: 1440, scale: 1.5, x: 0, y: 0, main: true },
                { width: 1920, height: 1080, scale: 1, x: -1920, y: 0 }
              ]
            },
            frontmost: { out: { name: 'Bloc de notas', bundleId: NOTEPAD, pid: 2 } },
            'app-at': { out: o.at ?? { name: 'Bloc de notas', bundleId: NOTEPAD, pid: 2 } },
            'list-apps': { out: [{ name: 'Bloc de notas', appKey: NOTEPAD, pid: 2 }] },
            'windows-of': o.windowsOf ?? { out: [{ title: 'Sin título', ...FRAME }] },
            'window-shot': {
              writeImage: true,
              out: {
                ok: true,
                width: 408,
                height: 308,
                title: 'Sin título',
                x: RECT.x,
                y: RECT.y,
                srcWidth: RECT.width,
                srcHeight: RECT.height,
                frame: FRAME
              }
            }
          }
        },
        env: { COMPUTER_BACKEND: 'win32', CU_HELPER_ARGV0: 'node', COMPUTER_AUTO_SCREENSHOT: '0', COMPUTER_INSTANT: '1' }
      })
      return {
        mcp,
        done: async () => {
          await mcp.stop()
          await s.close()
        }
      }
    }

    it('monitor a la izquierda: el centro de la imagen cae en el centro del rect y el clic llega con el punto global', async () => {
      const { mcp, done } = await bootWinShot()
      try {
        const { text: t } = await shot(mcp, SES, 'notepad')
        expect(t).toContain('408x308')
        const r = await mcp.call('left_click', { x: 204, y: 154, lazunox_session: SES }, HDRS)
        expect(r.isError, textOf(r)).not.toBe(true)
        // rect.x + 204 × 816/408 = -1908 + 408 = -1500; y = 92 + 154 × 616/308 = 400.
        expectCalls(clicks(mcp), [[-1500, 400, 'left', '1']])
      } finally {
        await done()
      }
    })

    it('píxeles en el borde invisible (dentro de la imagen, fuera del marco visible) ⇒ rechazo, también en drag', async () => {
      const { mcp, done } = await bootWinShot()
      try {
        await shot(mcp, SES, 'notepad')
        const r = await mcp.call('left_click', { x: 2, y: 2, lazunox_session: SES }, HDRS) // rect.x + 4 = -1904 < frame.x
        expect(r.isError).toBe(true)
        expect(textOf(r)).toContain('fuera de la ventana')
        const d = await mcp.call('drag', { start_x: 204, start_y: 154, end_x: 2, end_y: 2, lazunox_session: SES }, HDRS)
        expect(d.isError).toBe(true)
        expect(anyInput(mcp)).toBe(false)
      } finally {
        await done()
      }
    })

    it('la ventana se movió (windows-of con otro marco) ⇒ no se actúa', async () => {
      const { mcp, done } = await bootWinShot({ windowsOf: { out: [{ title: 'x', ...rect(-1800, 100, 800, 600) }] } })
      try {
        await shot(mcp, SES, 'notepad')
        const r = await mcp.call('left_click', { x: 204, y: 154, lazunox_session: SES }, HDRS)
        expect(r.isError).toBe(true)
        expect(textOf(r)).toContain('se movió')
        expect(anyInput(mcp)).toBe(false)
      } finally {
        await done()
      }
    })

    it('la app bajo el punto no es la capturada (app-at distinta no identificada) ⇒ no se actúa', async () => {
      const { mcp, done } = await bootWinShot({ at: { name: '', bundleId: '', pid: 0 } })
      try {
        await shot(mcp, SES, 'notepad')
        const r = await mcp.call('left_click', { x: 204, y: 154, lazunox_session: SES }, HDRS)
        expect(r.isError).toBe(true)
        expect(anyInput(mcp)).toBe(false)
      } finally {
        await done()
      }
    })

    it('sin app_screenshot previa el clic falla cerrado', async () => {
      const { mcp, done } = await bootWinShot()
      try {
        const r = await mcp.call('left_click', { x: 10, y: 10, lazunox_session: SES }, HDRS)
        expect(r.isError).toBe(true)
        expect(textOf(r)).toContain('app_screenshot')
        expect(anyInput(mcp)).toBe(false)
      } finally {
        await done()
      }
    })
  })
})
