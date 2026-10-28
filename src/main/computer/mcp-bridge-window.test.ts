/**
 * Modo de apps (origen aislado), mejoras de control (docs/PLAN-CONTROL-MEJOR.md §2.1, §2.2 y §2.4), con el helper FALSO y un canal lateral
 * simulado: zoom de la ventana concedida, aviso de ventana tapada y elementos numerados atados a una captura (`capture`).
 * Lo que más importa aquí: un `element` que ya no vale (captura vieja, ventana distinta, sesión ajena) NUNCA llega a hacer clic.
 */
import { existsSync, readdirSync } from 'node:fs'
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
import { BRIDGE_ORIGIN_HEADER, BRIDGE_SERVER_HEADER } from '../../shared/unified-bridge'
import { posixOnly } from '../../test/platform'

vi.setConfig({ testTimeout: 30_000 })

const work = tmpWork('lzx-mcp-window')
let bundle = ''
beforeAll(() => {
  bundle = bundleMcp(work.dir)
})
afterAll(() => work.cleanup())

const HDRS = { [BRIDGE_ORIGIN_HEADER]: 'secreto-de-prueba', [BRIDGE_SERVER_HEADER]: '/Users/ana/proyecto' }
const SES = 'ses_0123456789abcdef'
const SES2 = 'ses_fedcba9876543210'
const ISOLATED_OK = { isolated: true, ok: true }

type R = { x: number; y: number; width: number; height: number }
const rect = (x: number, y: number, width: number, height: number): R => ({ x, y, width, height })
const NOTES_APP = { name: 'Notes', bundleId: 'com.apple.Notes', pid: 100 }
const BRAVE_APP = { name: 'Brave Browser', bundleId: 'com.brave.Browser', pid: 200 }
const MAIN = { width: 1512, height: 982, scale: 2, x: 0, y: 0, main: true }
const LEFT = { width: 1920, height: 1080, scale: 1, x: -1920, y: 0 }
/** Ventana de Notas: 400x300 pt en el monitor de la izquierda; su captura retina mide 800x600 px. */
const FRAME = rect(-1500, 100, 400, 300)
const b64 = (png: Buffer): string => png.toString('base64')
const PNG_A = makePng(800, 600, 0x80)
const PNG_B = makePng(800, 600, 0x20)

let seq = 0
interface Setup {
  tier?: (b: string) => 'view' | 'click' | 'full' | null
  windowsOf?: unknown
  /** Respuestas de `window-shot` (una por llamada: la 1.ª es app_screenshot, las siguientes son sondas). */
  shots?: unknown[]
  elements?: unknown[]
  appAt?: unknown
  responses?: Record<string, unknown>
  env?: Record<string, string>
}

async function bootMac(o: Setup = {}): Promise<{ mcp: McpProc; side: SideChannel; done: () => Promise<void> }> {
  const side = await startSideChannel({ planApproved: false, bridgeCheck: () => ISOLATED_OK, tier: o.tier ?? (() => 'full') })
  const mcp = await startMcp({
    bundle,
    helper: FAKE_HELPER,
    dir: join(work.dir, `w${++seq}`),
    events: side,
    image: PNG_A,
    sipsSize: { width: 800, height: 600 },
    script: {
      responses: {
        screens: { out: [MAIN, LEFT] },
        'windows-of': o.windowsOf ?? { out: [{ title: 'V', ...FRAME }] },
        'window-shot': o.shots ?? { writeImage: true, out: { ok: true, width: 800, height: 600, title: 'Ventana' } },
        frontmost: { out: NOTES_APP },
        'app-at': { out: o.appAt ?? NOTES_APP },
        'resolve-app': { out: { ...NOTES_APP, found: true } },
        'zoom-image': { writeImage: true, out: { ok: true, width: 400, height: 320 } },
        ...(o.elements ? { 'find-elements': { out: o.elements } } : {}),
        ...(o.responses ?? {})
      }
    },
    env: { COMPUTER_AUTO_SCREENSHOT: '0', COMPUTER_INSTANT: '1', ...(o.env ?? {}) }
  })
  return {
    mcp,
    side,
    done: async () => {
      await mcp.stop()
      await side.close()
    }
  }
}

const shotOk = (png: Buffer = PNG_A): unknown => ({
  writeImage: true,
  imageB64: b64(png),
  out: { ok: true, width: 800, height: 600, title: 'Ventana' }
})
const EL = { role: 'AXButton', title: 'Reproducir', enabled: true, x: 0, y: 0, width: 40, height: 20, screenPoint: { x: -1300, y: 250 } }
const EL2 = { role: 'AXTextField', title: 'Buscar', enabled: true, x: 0, y: 0, width: 100, height: 20, screenPoint: { x: -1400, y: 130 } }
/** Fuera del marco de la ventana (a la derecha de ella): no debe salir en la lista. */
const EL_OUT = { ...EL, title: 'Afuera', screenPoint: { x: -1000, y: 250 } }

const clicks = (m: McpProc): string[][] =>
  m
    .calls()
    .filter((c) => c.cmd === 'click')
    .map((c) => c.args)
const anyInput = (m: McpProc): boolean => m.calls().some((c) => ['click', 'move', 'drag', 'scroll'].includes(c.cmd))
const hasImage = (r: { content: Array<{ type: string }> }): boolean => r.content.some((c) => c.type === 'image')
const reasons = (s: SideChannel): string[] =>
  s.requests.filter((r) => r.path === '/bridge-denied').map((r) => (r.body as { reason: string }).reason)

async function shot(m: McpProc, session = SES): Promise<{ text: string; id: number }> {
  const r = await m.call('app_screenshot', { app: 'Notes', lazunox_session: session }, HDRS)
  if (r.isError) throw new Error(textOf(r))
  const text = textOf(r)
  return { text, id: Number(/Captura #(\d+)/.exec(text)?.[1] ?? 0) }
}

const rawFiles = (m: McpProc): string[] =>
  existsSync(m.shotDir) ? readdirSync(m.shotDir).filter((f) => f.startsWith('shot-app-raw-')) : []

describe.skipIf(!posixOnly)('zoom de la ventana concedida (macOS)', () => {
  it('región dentro de la imagen: zoom-image sobre el PNG conservado, con los px convertidos; imagen solo de esa ventana', async () => {
    // JPEG de 400x300 (tope 400) sobre un PNG de 800x600: cada px del JPEG vale 2 del PNG.
    const { mcp, done } = await bootMac({ env: { COMPUTER_MAX_LONG_SIDE: '400' }, shots: [shotOk()] })
    try {
      const { text } = await shot(mcp)
      expect(text).toContain('400x300')
      expect(rawFiles(mcp)).toHaveLength(1)
      const r = await mcp.call('zoom', { x: 100, y: 50, width: 100, height: 80, lazunox_session: SES }, HDRS)
      expect(r.isError, textOf(r)).not.toBe(true)
      expect(hasImage(r)).toBe(true)
      expect(textOf(r)).toContain('SOLO para mirar')
      const z = mcp.calls().filter((c) => c.cmd === 'zoom-image')
      expect(z).toHaveLength(1)
      expect(z[0].args[0]).toMatch(/shot-app-raw-.*\.png$/)
      expect(z[0].args.slice(2)).toEqual(['200', '100', '200', '160', '2'])
      // Ninguna captura de pantalla completa en todo el recorrido.
      expect(mcp.calls().some((c) => /^screenshot|screencapture/.test(c.cmd))).toBe(false)
      // El archivo del resultado no queda en disco.
      expect(readdirSync(mcp.shotDir).filter((f) => f.startsWith('zoom-'))).toEqual([])
    } finally {
      await done()
    }
  })

  it('región fuera de la imagen o inválida ⇒ [rechazo: outside-window], sin llamar al helper', async () => {
    const { mcp, side, done } = await bootMac({ env: { COMPUTER_MAX_LONG_SIDE: '400' } })
    try {
      await shot(mcp)
      for (const reg of [
        { x: 350, y: 0, width: 100, height: 50 },
        { x: -1, y: 0, width: 10, height: 10 },
        { x: 0, y: 250, width: 10, height: 60 }
      ]) {
        const r = await mcp.call('zoom', { ...reg, lazunox_session: SES }, HDRS)
        expect(r.isError).toBe(true)
        expect(textOf(r)).toMatch(/^\[rechazo: outside-window\]/)
        expect(hasImage(r)).toBe(false)
      }
      const bad = await mcp.call('zoom', { x: 'a', y: 0, width: 10, height: 10, lazunox_session: SES }, HDRS)
      expect(bad.isError).toBe(true)
      expect(mcp.calls().some((c) => c.cmd === 'zoom-image')).toBe(false)
      await vi.waitFor(() => expect(reasons(side)).toContain('outside-window'))
    } finally {
      await done()
    }
  })

  it('sesión hermana: no puede ampliar la captura de otra sesión', async () => {
    const { mcp, done } = await bootMac()
    try {
      await shot(mcp, SES)
      const r = await mcp.call('zoom', { x: 0, y: 0, width: 100, height: 100, lazunox_session: SES2 }, HDRS)
      expect(r.isError).toBe(true)
      expect(textOf(r)).toMatch(/^\[rechazo: no-capture\]/)
      expect(hasImage(r)).toBe(false)
      expect(mcp.calls().some((c) => c.cmd === 'zoom-image')).toBe(false)
      // La suya sí funciona.
      const own = await mcp.call('zoom', { x: 0, y: 0, width: 100, height: 100, lazunox_session: SES }, HDRS)
      expect(own.isError, textOf(own)).not.toBe(true)
    } finally {
      await done()
    }
  })

  it('caduca con la captura (90 s; aquí acortado): [rechazo: capture-expired] y el PNG conservado se borra', async () => {
    const { mcp, done } = await bootMac({ env: { COMPUTER_WINDOW_CTX_TTL_MS: '400' } })
    try {
      await shot(mcp)
      expect(rawFiles(mcp)).toHaveLength(1)
      await new Promise((r) => setTimeout(r, 700))
      const r = await mcp.call('zoom', { x: 0, y: 0, width: 100, height: 100, lazunox_session: SES }, HDRS)
      expect(r.isError).toBe(true)
      expect(textOf(r)).toMatch(/^\[rechazo: capture-expired\]/)
      expect(rawFiles(mcp)).toHaveLength(0)
      expect(mcp.calls().some((c) => c.cmd === 'zoom-image')).toBe(false)
    } finally {
      await done()
    }
  })

  it('una captura nueva reemplaza a la anterior: solo queda un PNG conservado por sesión', async () => {
    const { mcp, done } = await bootMac()
    try {
      await shot(mcp)
      await shot(mcp)
      expect(rawFiles(mcp)).toHaveLength(1)
    } finally {
      await done()
    }
  })

  it('si la nueva app_screenshot FALLA, el zoom de la vieja deja de valer', async () => {
    const { mcp, done } = await bootMac({ shots: [shotOk(), { exit: 1, stderr: 'boom' }] })
    try {
      await shot(mcp)
      const fail = await mcp.call('app_screenshot', { app: 'Notes', lazunox_session: SES }, HDRS)
      expect(fail.isError).toBe(true)
      const r = await mcp.call('zoom', { x: 0, y: 0, width: 100, height: 100, lazunox_session: SES }, HDRS)
      expect(r.isError).toBe(true)
      expect(textOf(r)).toMatch(/^\[rechazo: no-capture\]/)
      expect(rawFiles(mcp)).toHaveLength(0)
    } finally {
      await done()
    }
  })

  it('tope de tamaño: COMPUTER_ZOOM_MAX_LONG se respeta y se acota a 400–2000', async () => {
    // El `zoom-image` falso escribe la imagen de 800x600 e informa 800x600: el MCP la reduce con sips al tope.
    const big = { writeImage: true, out: { ok: true, width: 800, height: 600 } }
    const a = await bootMac({ env: { COMPUTER_ZOOM_MAX_LONG: '500' }, responses: { 'zoom-image': big } })
    try {
      await shot(a.mcp)
      const r = await a.mcp.call('zoom', { x: 0, y: 0, width: 200, height: 150, lazunox_session: SES }, HDRS)
      expect(r.isError, textOf(r)).not.toBe(true)
      expect(textOf(r)).toContain('(resultado: 500x375 px)')
    } finally {
      await a.done()
    }
    const b = await bootMac({ env: { COMPUTER_ZOOM_MAX_LONG: '100' }, responses: { 'zoom-image': big } })
    try {
      await shot(b.mcp)
      const r = await b.mcp.call('zoom', { x: 0, y: 0, width: 200, height: 150, lazunox_session: SES }, HDRS)
      expect(textOf(r)).toContain('(resultado: 400x300 px)') // mínimo 400
    } finally {
      await b.done()
    }
  })

  it('app sin concesión ya (la quitaron entre la captura y el zoom) ⇒ no se enseña nada', async () => {
    let tier: 'full' | null = 'full'
    const { mcp, done } = await bootMac({ tier: () => tier })
    try {
      await shot(mcp)
      tier = null
      const r = await mcp.call('zoom', { x: 0, y: 0, width: 100, height: 100, lazunox_session: SES }, HDRS)
      expect(r.isError).toBe(true)
      expect(textOf(r)).toMatch(/^\[rechazo: no-grant\]/)
      expect(hasImage(r)).toBe(false)
      expect(mcp.calls().some((c) => c.cmd === 'zoom-image')).toBe(false)
    } finally {
      await done()
    }
  })

  it('fuera del modo de apps el zoom sigue siendo el de siempre (sin cabeceras: pide captura de pantalla completa)', async () => {
    const side = await startSideChannel({ planApproved: true })
    const mcp = await startMcp({
      bundle,
      helper: FAKE_HELPER,
      dir: join(work.dir, `w${++seq}`),
      events: side,
      env: { COMPUTER_AUTO_SCREENSHOT: '0' }
    })
    try {
      const r = await mcp.call('zoom', { x: 0, y: 0, width: 10, height: 10, lazunox_session: SES })
      expect(textOf(r)).toContain('Todavía no hay ninguna captura de pantalla completa')
    } finally {
      await mcp.stop()
      await side.close()
    }
  })
})

describe.skipIf(!posixOnly)('zoom de la ventana concedida (Windows)', () => {
  const NOTEPAD = 'exe:c:\\windows\\system32\\notepad.exe|pub:microsoft windows'
  const RECT = rect(-1908, 92, 816, 616)
  const WFRAME = rect(-1900, 100, 800, 600)
  const info = (r: R = RECT, extra: Record<string, unknown> = {}): unknown => ({
    writeImage: true,
    out: {
      ok: true,
      width: 408,
      height: 308,
      title: 'Sin título',
      x: r.x,
      y: r.y,
      srcWidth: r.width,
      srcHeight: r.height,
      frame: WFRAME,
      ...extra
    }
  })

  async function bootWin(responses: Record<string, unknown>): Promise<{ mcp: McpProc; side: SideChannel; done: () => Promise<void> }> {
    const side = await startSideChannel({
      planApproved: false,
      bridgeCheck: () => ISOLATED_OK,
      tier: (b) => (b === NOTEPAD ? 'full' : null)
    })
    const mcp = await startMcp({
      bundle,
      helper: FAKE_HELPER,
      dir: join(work.dir, `w${++seq}`),
      platform: 'win32',
      events: side,
      image: PNG_A,
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
          'app-at': { out: { name: 'Bloc de notas', bundleId: NOTEPAD, pid: 2 } },
          'list-apps': { out: [{ name: 'Bloc de notas', appKey: NOTEPAD, pid: 2 }] },
          'windows-of': { out: [{ title: 'Sin título', ...WFRAME }] },
          ...responses
        }
      },
      env: { COMPUTER_BACKEND: 'win32', CU_HELPER_ARGV0: 'node', COMPUTER_AUTO_SCREENSHOT: '0', COMPUTER_INSTANT: '1' }
    })
    return {
      mcp,
      side,
      done: async () => {
        await mcp.stop()
        await side.close()
      }
    }
  }
  const winShot = async (m: McpProc): Promise<string> => {
    const r = await m.call('app_screenshot', { app: 'notepad', lazunox_session: SES }, HDRS)
    if (r.isError) throw new Error(textOf(r))
    return textOf(r)
  }
  const zoomCrop = (r: R, crop: R): unknown => ({
    writeImage: true,
    out: { ok: true, width: 200, height: 100, x: r.x, y: r.y, srcWidth: r.width, srcHeight: r.height, crop }
  })

  it('el recorte va en px del rectángulo de origen (JPEG 408x308 ↔ rect 816x616) y llega con --crop', async () => {
    const { mcp, done } = await bootWin({ 'window-shot': [info(), zoomCrop(RECT, rect(20, 20, 200, 100))] })
    try {
      await winShot(mcp)
      const r = await mcp.call('zoom', { x: 10, y: 10, width: 100, height: 50, lazunox_session: SES }, HDRS)
      expect(r.isError, textOf(r)).not.toBe(true)
      expect(hasImage(r)).toBe(true)
      const calls = mcp.calls().filter((c) => c.cmd === 'window-shot')
      expect(calls).toHaveLength(2)
      expect(calls[1].args).toContain('--crop')
      expect(calls[1].args[calls[1].args.indexOf('--crop') + 1]).toBe('20,20,200,100')
    } finally {
      await done()
    }
  })

  it('la ventana se movió entre la captura y el zoom (rect distinto) ⇒ [rechazo: window-moved] y NO se enseña la imagen', async () => {
    const moved = rect(RECT.x + 50, RECT.y, RECT.width, RECT.height)
    const { mcp, side, done } = await bootWin({ 'window-shot': [info(), zoomCrop(moved, rect(20, 20, 200, 100))] })
    try {
      await winShot(mcp)
      const r = await mcp.call('zoom', { x: 10, y: 10, width: 100, height: 50, lazunox_session: SES }, HDRS)
      expect(r.isError).toBe(true)
      expect(textOf(r)).toMatch(/^\[rechazo: window-moved\]/)
      expect(hasImage(r)).toBe(false)
      await vi.waitFor(() => expect(reasons(side)).toContain('window-moved'))
      // Y la captura anterior deja de servir para clics.
      const click = await mcp.call('left_click', { x: 10, y: 10, lazunox_session: SES }, HDRS)
      expect(click.isError).toBe(true)
      expect(anyInput(mcp)).toBe(false)
    } finally {
      await done()
    }
  })

  it('helper sin soporte de recorte (no repite el crop pedido) ⇒ zoom no disponible, sin imagen', async () => {
    const { mcp, done } = await bootWin({ 'window-shot': [info(), zoomCrop(RECT, rect(0, 0, 5, 5))] })
    try {
      await winShot(mcp)
      const r = await mcp.call('zoom', { x: 10, y: 10, width: 100, height: 50, lazunox_session: SES }, HDRS)
      expect(r.isError).toBe(true)
      expect(textOf(r)).toContain('zoom no está disponible')
      expect(hasImage(r)).toBe(false)
    } finally {
      await done()
    }
  })
})

describe.skipIf(!posixOnly)('aviso de ventana tapada en app_screenshot', () => {
  it('macOS: running-apps + windows-of + app-at ⇒ nombre y porcentaje de quien tapa, sin rectángulos', async () => {
    const { mcp, done } = await bootMac({
      windowsOf: [
        { out: [{ title: 'V', ...FRAME }] }, // ubicar la ventana
        { out: [{ title: 'V', ...FRAME }] }, // marcos propios
        // Orden Z (delante → atrás): Brave tapa la mitad derecha de la ventana de Notas.
        {
          out: [
            { title: 'Secreto de otra app', ...rect(-1300, 100, 200, 300) },
            { title: 'V', ...FRAME }
          ]
        }
      ],
      responses: { 'running-apps': { out: [BRAVE_APP, NOTES_APP] }, 'app-at': { out: BRAVE_APP } }
    })
    try {
      const { text } = await shot(mcp)
      expect(text).toContain('«Brave Browser» tapa ~50 %')
      expect(text).toContain('los clics en la zona tapada se rechazarán')
      expect(text).not.toMatch(/Secreto de otra app|-1300|-1100/)
      expect(mcp.calls().filter((c) => c.cmd === 'app-at').length).toBeLessThanOrEqual(3)
    } finally {
      await done()
    }
  })

  it('macOS: nada la tapa ⇒ sin línea de aviso y sin llamadas app-at', async () => {
    const { mcp, done } = await bootMac({ responses: { 'running-apps': { out: [NOTES_APP] } } })
    try {
      const { text } = await shot(mcp)
      expect(text).not.toContain('Ojo:')
      expect(text).not.toContain('tapa')
      expect(mcp.calls().filter((c) => c.cmd === 'app-at')).toHaveLength(0)
    } finally {
      await done()
    }
  })

  describe('Windows (covered del helper)', () => {
    const NOTEPAD = 'exe:c:\\windows\\system32\\notepad.exe|pub:microsoft windows'
    const WRECT = rect(-1908, 92, 816, 616)
    const WFRAME = rect(-1900, 100, 800, 600)
    async function bootWin(extra: Record<string, unknown>): Promise<{ mcp: McpProc; done: () => Promise<void> }> {
      const side = await startSideChannel({
        planApproved: false,
        bridgeCheck: () => ISOLATED_OK,
        tier: (b) => (b === NOTEPAD ? 'full' : null)
      })
      const mcp = await startMcp({
        bundle,
        helper: FAKE_HELPER,
        dir: join(work.dir, `w${++seq}`),
        platform: 'win32',
        events: side,
        image: PNG_A,
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
            'app-at': { out: { name: 'Bloc de notas', bundleId: NOTEPAD, pid: 2 } },
            'list-apps': { out: [{ name: 'Bloc de notas', appKey: NOTEPAD, pid: 2 }] },
            'windows-of': { out: [{ title: 'Sin título', ...WFRAME }] },
            'window-shot': {
              writeImage: true,
              out: {
                ok: true,
                width: 408,
                height: 308,
                title: 'Sin título',
                x: WRECT.x,
                y: WRECT.y,
                srcWidth: WRECT.width,
                srcHeight: WRECT.height,
                frame: WFRAME,
                ...extra
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
          await side.close()
        }
      }
    }
    const take = async (m: McpProc): Promise<string> => {
      const r = await m.call('app_screenshot', { app: 'notepad', lazunox_session: SES }, HDRS)
      if (r.isError) throw new Error(textOf(r))
      return textOf(r)
    }

    it('covered guionado ⇒ nombre y porcentaje', async () => {
      const { mcp, done } = await bootWin({ covered: [{ name: 'Brave Browser', pct: 40 }], coveredPct: 40 })
      try {
        const t = await take(mcp)
        expect(t).toContain('«Brave Browser» tapa ~40 %')
        expect(t).not.toMatch(/-19\d\d|\b616\b/) // ni rectángulos
      } finally {
        await done()
      }
    })

    it('sin tapar (covered vacío) ⇒ sin línea de aviso', async () => {
      const { mcp, done } = await bootWin({ covered: [], coveredPct: 0 })
      try {
        expect(await take(mcp)).not.toContain('Ojo:')
      } finally {
        await done()
      }
    })

    it('helper viejo (sin covered) ⇒ «no se pudo comprobar» y nada más', async () => {
      const { mcp, done } = await bootWin({ covered: undefined, coveredPct: undefined })
      try {
        const t = await take(mcp)
        expect(t).toContain('No se pudo comprobar si esta ventana está tapada')
      } finally {
        await done()
      }
    })
  })
})

describe.skipIf(!posixOnly)('elementos numerados atados a una captura (macOS)', () => {
  it('la captura trae «Captura #N» y fichas con el punto en px de la imagen; lo que cae fuera del marco no sale', async () => {
    const { mcp, done } = await bootMac({ elements: [EL2, EL, EL_OUT], env: { COMPUTER_MAX_LONG_SIDE: '800' } })
    try {
      const { text, id } = await shot(mcp)
      expect(id).toBeGreaterThan(0)
      expect(text).toContain(`Captura #${id} — elementos de Notes (para pulsar uno: element: N y capture: ${id}`)
      // Ordenados de arriba abajo: «Buscar» (-1400,130) → (200, 60) px; «Reproducir» (-1300,250) → (400, 300) px.
      expect(text).toContain('[1] campo de texto «Buscar» (200, 60)')
      expect(text).toContain('[2] botón «Reproducir» (400, 300) 80×40')
      expect(text).not.toContain('Afuera')
      expect(text).not.toMatch(/-1300|-1400/)
    } finally {
      await done()
    }
  })

  it('element + capture vigente y ventana igual ⇒ el clic llega al helper en el punto del elemento', async () => {
    const { mcp, done } = await bootMac({ elements: [EL] })
    try {
      const { id } = await shot(mcp)
      const r = await mcp.call('left_click', { element: 1, capture: id, lazunox_session: SES }, HDRS)
      expect(r.isError, textOf(r)).not.toBe(true)
      expect(clicks(mcp)).toEqual([['-1300', '250', 'left', '1']])
      // La sonda previa al clic se pidió (una captura de la ventana más allá de la de app_screenshot) y se borró.
      expect(mcp.calls().filter((c) => c.cmd === 'window-shot')).toHaveLength(2)
      expect(readdirSync(mcp.shotDir).filter((f) => f.startsWith('probe-'))).toEqual([])
    } finally {
      await done()
    }
  })

  it('element SIN capture ⇒ [rechazo: capture-required], sin clic ni sonda', async () => {
    const { mcp, done } = await bootMac({ elements: [EL] })
    try {
      await shot(mcp)
      const r = await mcp.call('left_click', { element: 1, lazunox_session: SES }, HDRS)
      expect(r.isError).toBe(true)
      expect(textOf(r)).toMatch(/^\[rechazo: capture-required\]/)
      expect(anyInput(mcp)).toBe(false)
      expect(mcp.calls().filter((c) => c.cmd === 'window-shot')).toHaveLength(1)
    } finally {
      await done()
    }
  })

  it('capture VIEJO (hubo una captura nueva) ⇒ [rechazo: stale] y ninguna llamada click', async () => {
    const { mcp, side, done } = await bootMac({ elements: [EL] })
    try {
      const first = await shot(mcp)
      const second = await shot(mcp)
      expect(second.id).not.toBe(first.id)
      const r = await mcp.call('left_click', { element: 1, capture: first.id, lazunox_session: SES }, HDRS)
      expect(r.isError).toBe(true)
      expect(textOf(r)).toMatch(/^\[rechazo: stale\]/)
      expect(clicks(mcp)).toEqual([])
      expect(anyInput(mcp)).toBe(false)
      await vi.waitFor(() => expect(reasons(side)).toContain('stale'))
      // Con el id nuevo sí.
      const ok = await mcp.call('left_click', { element: 1, capture: second.id, lazunox_session: SES }, HDRS)
      expect(ok.isError, textOf(ok)).not.toBe(true)
      expect(clicks(mcp)).toHaveLength(1)
    } finally {
      await done()
    }
  })

  it('la ventana cambió desde la captura (sonda distinta) ⇒ [rechazo: stale], NINGUNA llamada click, y la lista queda invalidada', async () => {
    const { mcp, done } = await bootMac({ elements: [EL], shots: [shotOk(PNG_A), shotOk(PNG_B)] })
    try {
      const { id } = await shot(mcp)
      const r = await mcp.call('left_click', { element: 1, capture: id, lazunox_session: SES }, HDRS)
      expect(r.isError).toBe(true)
      expect(textOf(r)).toMatch(/^\[rechazo: stale\]/)
      expect(textOf(r)).toContain('ya no se ve como en la captura')
      expect(mcp.calls().some((c) => c.cmd === 'click')).toBe(false)
      // Otra vez con el mismo id: sigue sin valer aunque la ventana volviera a ser igual (la lista se invalidó).
      const again = await mcp.call('left_click', { element: 1, capture: id, lazunox_session: SES }, HDRS)
      expect(again.isError).toBe(true)
      expect(textOf(again)).toMatch(/^\[rechazo: stale\]/)
      expect(mcp.calls().some((c) => c.cmd === 'click')).toBe(false)
    } finally {
      await done()
    }
  })

  it('la sonda no se puede tomar (el helper falla) ⇒ por seguridad también es stale, sin clic', async () => {
    const { mcp, done } = await bootMac({ elements: [EL], shots: [shotOk(), { exit: 1, stderr: 'boom' }] })
    try {
      const { id } = await shot(mcp)
      const r = await mcp.call('left_click', { element: 1, capture: id, lazunox_session: SES }, HDRS)
      expect(r.isError).toBe(true)
      expect(textOf(r)).toMatch(/^\[rechazo: stale\]/)
      expect(textOf(r)).toContain('No se pudo comprobar')
      expect(anyInput(mcp)).toBe(false)
    } finally {
      await done()
    }
  })

  it('la captura no se pudo leer (sin firma) ⇒ no hay lista de elementos', async () => {
    // Un PNG roto como captura: el MCP no puede comparar después, así que no ofrece lista.
    const { mcp, done } = await bootMac({
      elements: [EL],
      shots: [{ writeImage: true, imageB64: Buffer.from('no soy un png').toString('base64'), out: { ok: true, width: 800, height: 600 } }]
    })
    try {
      // sips real no puede convertir ese archivo ⇒ la captura falla entera (nada que pueda usarse).
      const r = await mcp.call('app_screenshot', { app: 'Notes', lazunox_session: SES }, HDRS)
      expect(textOf(r)).not.toContain('Captura #')
    } finally {
      await done()
    }
  })

  it('elemento fuera del marco: no sale en la lista y pedirlo no hace clic', async () => {
    const { mcp, done } = await bootMac({ elements: [EL, EL_OUT] })
    try {
      const { id, text } = await shot(mcp)
      expect(text).toContain('[1] botón «Reproducir»')
      expect(text).not.toContain('[2]')
      const r = await mcp.call('left_click', { element: 2, capture: id, lazunox_session: SES }, HDRS)
      expect(r.isError).toBe(true)
      expect(textOf(r)).toContain('No hay elemento 2')
      expect(anyInput(mcp)).toBe(false)
    } finally {
      await done()
    }
  })

  it('sesión hermana: no ve ni usa la lista de otra (ni con su id ni con el suyo propio)', async () => {
    const { mcp, done } = await bootMac({ elements: [EL] })
    try {
      const a = await shot(mcp, SES)
      // Sin captura propia.
      const sin = await mcp.call('left_click', { element: 1, capture: a.id, lazunox_session: SES2 }, HDRS)
      expect(sin.isError).toBe(true)
      expect(textOf(sin)).toMatch(/^\[rechazo: no-capture\]/)
      // Con captura propia pero usando el id de la otra.
      const b = await shot(mcp, SES2)
      expect(b.id).not.toBe(a.id)
      const cruzado = await mcp.call('left_click', { element: 1, capture: a.id, lazunox_session: SES2 }, HDRS)
      expect(cruzado.isError).toBe(true)
      expect(textOf(cruzado)).toMatch(/^\[rechazo: stale\]/)
      expect(anyInput(mcp)).toBe(false)
      // Cada una con lo suyo.
      expect((await mcp.call('left_click', { element: 1, capture: a.id, lazunox_session: SES }, HDRS)).isError).not.toBe(true)
      expect((await mcp.call('left_click', { element: 1, capture: b.id, lazunox_session: SES2 }, HDRS)).isError).not.toBe(true)
      expect(clicks(mcp)).toHaveLength(2)
    } finally {
      await done()
    }
  })

  it('captura caducada (90 s; aquí acortado) ⇒ [rechazo: capture-expired], sin clic', async () => {
    const { mcp, done } = await bootMac({ elements: [EL], env: { COMPUTER_WINDOW_CTX_TTL_MS: '400' } })
    try {
      const { id } = await shot(mcp)
      await new Promise((r) => setTimeout(r, 700))
      const r = await mcp.call('left_click', { element: 1, capture: id, lazunox_session: SES }, HDRS)
      expect(r.isError).toBe(true)
      expect(textOf(r)).toMatch(/^\[rechazo: capture-expired\]/)
      expect(anyInput(mcp)).toBe(false)
    } finally {
      await done()
    }
  })

  it('element no esquiva las comprobaciones de x/y: otra app bajo el punto ⇒ [rechazo: covered]; ventana movida ⇒ window-moved; «solo ver» ⇒ low-tier', async () => {
    // Otra app encima del elemento.
    const a = await bootMac({ elements: [EL], appAt: { name: 'Slack', bundleId: 'com.tinyspeck.slackmacgap', pid: 9 } })
    try {
      const { id } = await shot(a.mcp)
      const r = await a.mcp.call('left_click', { element: 1, capture: id, lazunox_session: SES }, HDRS)
      expect(textOf(r)).toMatch(/^\[rechazo: covered\]/)
      expect(textOf(r)).toContain('«Slack»')
      expect(anyInput(a.mcp)).toBe(false)
    } finally {
      await a.done()
    }
    // La ventana se movió entre la captura y el clic.
    const b = await bootMac({
      elements: [EL],
      windowsOf: [
        { out: [{ title: 'V', ...FRAME }] }, // ubicar
        { out: [{ title: 'V', ...FRAME }] }, // marcos propios (aviso de tapado)
        { out: [{ title: 'V', ...FRAME }] }, // pila (aviso de tapado)
        { out: [{ title: 'V', ...rect(-1400, 100, 400, 300) }] } // recheckWindow del clic
      ]
    })
    try {
      const { id } = await shot(b.mcp)
      const r = await b.mcp.call('left_click', { element: 1, capture: id, lazunox_session: SES }, HDRS)
      expect(r.isError).toBe(true)
      expect(textOf(r)).toMatch(/^\[rechazo: window-moved\]/)
      expect(anyInput(b.mcp)).toBe(false)
    } finally {
      await b.done()
    }
    // Nivel insuficiente: con «solo ver» no hay ni lista.
    const c = await bootMac({ elements: [EL], tier: () => 'view' })
    try {
      const { text } = await shot(c.mcp)
      expect(text).not.toContain('Captura #')
      expect(c.mcp.calls().some((x) => x.cmd === 'find-elements')).toBe(false)
      const r = await c.mcp.call('left_click', { element: 1, capture: 1, lazunox_session: SES }, HDRS)
      expect(r.isError).toBe(true)
      expect(anyInput(c.mcp)).toBe(false)
    } finally {
      await c.done()
    }
  })

  it('batch: un paso con element obsoleto detiene el lote y NO hace clic', async () => {
    const { mcp, done } = await bootMac({ elements: [EL], shots: [shotOk(PNG_A), shotOk(PNG_B)] })
    try {
      const { id } = await shot(mcp)
      const r = await mcp.call(
        'batch',
        {
          actions: [
            { tool: 'left_click', args: { element: 1, capture: id } },
            { tool: 'key', args: { keys: 'return' } }
          ],
          lazunox_session: SES
        },
        HDRS
      )
      expect(textOf(r)).toContain('ERROR — [rechazo: stale]')
      expect(textOf(r)).toContain('Lote detenido en el paso 1')
      expect(anyInput(mcp)).toBe(false)
      expect(mcp.calls().some((c) => c.cmd === 'key')).toBe(false)
    } finally {
      await done()
    }
  })

  it('fuera del origen aislado: element sigue usando la lista global de pantalla completa (capture se ignora)', async () => {
    const side = await startSideChannel({ planApproved: true })
    const mcp = await startMcp({
      bundle,
      helper: FAKE_HELPER,
      dir: join(work.dir, `w${++seq}`),
      events: side,
      image: makePng(1440, 900),
      sipsSize: { width: 1440, height: 900 },
      script: { responses: { 'find-elements': { out: [EL] } } },
      env: { COMPUTER_AUTO_SCREENSHOT: '0', COMPUTER_INSTANT: '1' }
    })
    try {
      const r = await mcp.call('left_click', { element: 1, capture: 5, lazunox_session: SES })
      expect(r.isError).toBe(true)
      expect(textOf(r)).toContain('La lista de elementos caducó o no existe')
    } finally {
      await mcp.stop()
      await side.close()
    }
  })
})

describe.skipIf(!posixOnly)('elementos numerados atados a una captura (Windows)', () => {
  const NOTEPAD = 'exe:c:\\windows\\system32\\notepad.exe|pub:microsoft windows'
  const RECT = rect(-1908, 92, 816, 616)
  const WFRAME = rect(-1900, 100, 800, 600)
  const WEL = { role: 'Button', title: 'Guardar', enabled: true, x: 0, y: 0, width: 80, height: 40, screenPoint: { x: -1500, y: 400 } }

  it('lista con la firma de la miniatura --probe; el clic por element comprueba con una sonda --max-long 256', async () => {
    const side = await startSideChannel({
      planApproved: false,
      bridgeCheck: () => ISOLATED_OK,
      tier: (b) => (b === NOTEPAD ? 'full' : null)
    })
    const mcp = await startMcp({
      bundle,
      helper: FAKE_HELPER,
      dir: join(work.dir, `w${++seq}`),
      platform: 'win32',
      events: side,
      image: PNG_A,
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
          'app-at': { out: { name: 'Bloc de notas', bundleId: NOTEPAD, pid: 2 } },
          'list-apps': { out: [{ name: 'Bloc de notas', appKey: NOTEPAD, pid: 2 }] },
          'windows-of': { out: [{ title: 'Sin título', ...WFRAME }] },
          'find-elements': { out: [WEL] },
          'window-shot': {
            writeImage: true,
            probeB64: b64(PNG_A),
            out: {
              ok: true,
              width: 408,
              height: 308,
              title: 'Sin título',
              x: RECT.x,
              y: RECT.y,
              srcWidth: RECT.width,
              srcHeight: RECT.height,
              frame: WFRAME,
              covered: [],
              coveredPct: 0
            }
          }
        }
      },
      env: { COMPUTER_BACKEND: 'win32', CU_HELPER_ARGV0: 'node', COMPUTER_AUTO_SCREENSHOT: '0', COMPUTER_INSTANT: '1' }
    })
    try {
      const r0 = await mcp.call('app_screenshot', { app: 'notepad', lazunox_session: SES }, HDRS)
      expect(r0.isError, textOf(r0)).not.toBe(true)
      const t = textOf(r0)
      const id = Number(/Captura #(\d+)/.exec(t)?.[1] ?? 0)
      expect(id).toBeGreaterThan(0)
      expect(t).toContain('[1] Button «Guardar»')
      const shotCall = mcp.calls().find((c) => c.cmd === 'window-shot')!
      expect(shotCall.args).toContain('--probe')
      const r = await mcp.call('left_click', { element: 1, capture: id, lazunox_session: SES }, HDRS)
      expect(r.isError, textOf(r)).not.toBe(true)
      expect(clicks(mcp)).toEqual([['-1500', '400', 'left', '1']])
      const probes = mcp.calls().filter((c) => c.cmd === 'window-shot' && c.args.includes('256'))
      expect(probes).toHaveLength(1)
    } finally {
      await mcp.stop()
      await side.close()
    }
  })
})
