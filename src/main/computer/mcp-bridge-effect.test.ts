/**
 * Modo de apps (origen aislado), mejoras de control (docs/PLAN-CONTROL-MEJOR.md §2.3 y §2.5), con el helper FALSO y un canal lateral simulado:
 * veredicto de acción (`efecto: confirmed | unverifiable | suspected_noop`) con sondas antes/después, foco tras teclear (`type_text` por
 * trozos y `[rechazo: focus-stolen]`), `wait` con condición y `screenshot: true/false`.
 * Lo que más importa aquí: las sondas nunca llegan al modelo y se borran; `screenshot: true` solo captura LA VENTANA de la app concedida;
 * el troceo no cambia el texto que se escribe; y fuera del modo de apps no cambia nada.
 *
 * Los tiempos son reales (el MCP corre como proceso aparte con el sondeo de 400 ms): un «no cambió» tarda ~1,6 s en una app local y ~4,4 s con
 * un cliente de escritorio remoto, así que cada prueba de «sin cambios» cuesta un par de segundos.
 */
import { existsSync, mkdirSync, readdirSync, utimesSync, writeFileSync } from 'node:fs'
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

vi.setConfig({ testTimeout: 40_000 })

const work = tmpWork('lzx-mcp-effect')
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
const NOTES = { name: 'Notes', bundleId: 'com.apple.Notes', pid: 100 }
const OTRA = { name: 'Otra', bundleId: 'com.otra.App', pid: 300 }
const REMOTA = { name: 'Windows App', bundleId: 'com.microsoft.rdc.macos', pid: 400 }
const MAIN = { width: 1512, height: 982, scale: 2, x: 0, y: 0, main: true }
/** Ventana de 400x300 pt en el monitor principal; su captura retina mide 800x600 px. */
const FRAME = rect(100, 100, 400, 300)
const b64 = (png: Buffer): string => png.toString('base64')
const PNG_A = makePng(800, 600, 0x80)
const PNG_B = makePng(800, 600, 0x20)
const shotOf = (png: Buffer): unknown => ({
  writeImage: true,
  imageB64: b64(png),
  out: { ok: true, width: 800, height: 600, title: 'Ventana' }
})
const A = shotOf(PNG_A)
const B = shotOf(PNG_B)
const FAIL = { exit: 7, stderr: 'la app no está en ejecución' }
const FIELD = (value: string): unknown => ({
  role: 'AXTextArea',
  value,
  enabled: true,
  x: 0,
  y: 0,
  width: 300,
  height: 100,
  screenPoint: { x: 200, y: 200 }
})
const BUTTON = {
  role: 'AXButton',
  title: 'Listo',
  enabled: true,
  x: 0,
  y: 0,
  width: 40,
  height: 20,
  screenPoint: { x: 200, y: 150 }
}

let seq = 0
interface Setup {
  tier?: (b: string) => 'view' | 'click' | 'full' | null
  /** Respuestas de `window-shot` (una por llamada: la 1.ª es app_screenshot, la 2.ª la sonda de antes, las demás las de después). */
  shots?: unknown[]
  front?: unknown
  responses?: Record<string, unknown>
  verdict?: boolean
  isolated?: boolean
  /** Kill-switch simulado (Detener). */
  stopped?: () => boolean
  env?: Record<string, string>
}

async function bootMac(o: Setup = {}): Promise<{ mcp: McpProc; side: SideChannel; done: () => Promise<void> }> {
  const side = await startSideChannel({
    planApproved: o.isolated === false,
    bridgeCheck: () => (o.isolated === false ? { isolated: false, ok: false } : ISOLATED_OK),
    tier: o.tier ?? (() => 'full'),
    stopped: o.stopped
  })
  const front = o.front ?? NOTES
  const mcp = await startMcp({
    bundle,
    helper: FAKE_HELPER,
    dir: join(work.dir, `w${++seq}`),
    events: side,
    image: PNG_A,
    sipsSize: { width: 800, height: 600 },
    script: {
      responses: {
        screens: { out: [MAIN] },
        'windows-of': { out: [{ title: 'V', ...FRAME }] },
        'window-shot': o.shots ?? [A],
        frontmost: Array.isArray(front) ? front.map((f) => ({ out: f })) : { out: front },
        'app-at': { out: Array.isArray(front) ? front[0] : front },
        'resolve-app': { out: { ...(Array.isArray(front) ? front[0] : front), found: true } },
        'zoom-image': { writeImage: true, out: { ok: true, width: 400, height: 320 } },
        'find-elements': { out: [] },
        ...(o.responses ?? {})
      }
    },
    env: { COMPUTER_AUTO_SCREENSHOT: '0', COMPUTER_INSTANT: '1', COMPUTER_VERDICT: o.verdict === false ? '0' : '1', ...(o.env ?? {}) }
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

const call = (m: McpProc, name: string, args: Record<string, unknown>, session = SES) =>
  m.call(name, { ...args, lazunox_session: session }, HDRS)

async function shot(m: McpProc, session = SES, app = 'Notes'): Promise<number> {
  const r = await call(m, 'app_screenshot', { app }, session)
  if (r.isError) throw new Error(textOf(r))
  return Number(/Captura #(\d+)/.exec(textOf(r))?.[1] ?? 0)
}

const firstLine = (r: { content: Array<{ type: string; text?: string }> }): string => textOf(r).split('\n')[0]
const hasImage = (r: { content: Array<{ type: string }> }): boolean => r.content.some((c) => c.type === 'image')
const clicks = (m: McpProc): string[][] =>
  m
    .calls()
    .filter((c) => c.cmd === 'click')
    .map((c) => c.args)
const typed = (m: McpProc): string[] =>
  m
    .calls()
    .filter((c) => c.cmd === 'type')
    .map((c) => c.args[0])
const shotCalls = (m: McpProc) => m.calls().filter((c) => c.cmd === 'window-shot')
const reasons = (s: SideChannel): string[] =>
  s.requests.filter((r) => r.path === '/bridge-denied').map((r) => (r.body as { reason: string }).reason)
/** Sondas que quedaron en disco (no debe quedar ninguna). */
const probeFiles = (m: McpProc): string[] => (existsSync(m.shotDir) ? readdirSync(m.shotDir).filter((f) => /^probe-/.test(f)) : [])

async function timed<T>(f: () => Promise<T>): Promise<{ r: T; ms: number }> {
  const t = Date.now()
  const r = await f()
  return { r, ms: Date.now() - t }
}

describe.skipIf(!posixOnly)('veredicto de acción (macOS)', () => {
  it('sondas iguales ⇒ suspected_noop en la PRIMERA línea, con la escalada de x/y; el clic sí se entregó y la sonda no queda ni se nombra', async () => {
    const { mcp, done } = await bootMac()
    try {
      await shot(mcp)
      const { r, ms } = await timed(() => call(mcp, 'left_click', { x: 100, y: 100 }))
      expect(r.isError, textOf(r)).not.toBe(true)
      expect(firstLine(r)).toMatch(/^efecto: suspected_noop — la ventana no cambió y la acción debería verse; siguiente: prueba element: N/)
      expect(clicks(mcp)).toHaveLength(1)
      // Local: ~1,6 s de sondeo (no 4 s de escritorio remoto).
      expect(ms).toBeGreaterThan(1300)
      expect(ms).toBeLessThan(3600)
      // Las sondas nunca llegan al modelo ni quedan en disco.
      expect(textOf(r)).not.toMatch(/probe-|\.png|data:image/)
      expect(hasImage(r)).toBe(false)
      expect(probeFiles(mcp)).toEqual([])
      // Se sondeó la ventana 0 de la app concedida (nunca pantalla completa).
      expect(shotCalls(mcp).length).toBeGreaterThanOrEqual(3)
      expect(mcp.calls().some((c) => /^screenshot/.test(c.cmd))).toBe(false)
    } finally {
      await done()
    }
  })

  it('la SEGUNDA suspected_noop sobre el mismo punto (±8 px) dice «no repitas»; otro punto lejano no; otra sesión tampoco', async () => {
    const { mcp, done } = await bootMac()
    try {
      await shot(mcp, SES)
      const r1 = await call(mcp, 'left_click', { x: 100, y: 100 })
      expect(firstLine(r1)).toContain('suspected_noop')
      expect(firstLine(r1)).not.toContain('no repitas')
      const r2 = await call(mcp, 'left_click', { x: 104, y: 97 })
      expect(firstLine(r2)).toContain('suspected_noop')
      expect(firstLine(r2)).toContain('siguiente: no repitas')
      const far = await call(mcp, 'left_click', { x: 600, y: 500 })
      expect(firstLine(far)).toContain('suspected_noop')
      expect(firstLine(far)).not.toContain('no repitas')
      // Sesión hermana: su registro es SUYO (aunque sea el mismo punto y la misma app).
      await shot(mcp, SES2)
      const other = await call(mcp, 'left_click', { x: 100, y: 100 }, SES2)
      expect(firstLine(other)).toContain('suspected_noop')
      expect(firstLine(other)).not.toContain('no repitas')
    } finally {
      await done()
    }
  })

  it('sondas distintas ⇒ unverifiable con el %, rápido (vuelve en cuanto algo cambia)', async () => {
    const { mcp, done } = await bootMac({ shots: [A, A, B] })
    try {
      await shot(mcp)
      const { r, ms } = await timed(() => call(mcp, 'left_click', { x: 100, y: 100 }))
      expect(firstLine(r)).toMatch(/^efecto: unverifiable — se entregó; la ventana cambió ~\d+ %/)
      expect(firstLine(r)).toContain('confírmalo con app_screenshot')
      expect(ms).toBeLessThan(2600)
    } finally {
      await done()
    }
  })

  it('la sonda de después falla (la app no responde) ⇒ unverifiable, nunca un error', async () => {
    const { mcp, done } = await bootMac({ shots: [A, A, FAIL] })
    try {
      await shot(mcp)
      const r = await call(mcp, 'left_click', { x: 100, y: 100 })
      expect(r.isError, textOf(r)).not.toBe(true)
      expect(firstLine(r)).toMatch(/^efecto: unverifiable — se entregó; no se pudo comparar la ventana/)
      expect(clicks(mcp)).toHaveLength(1)
      expect(probeFiles(mcp)).toEqual([])
    } finally {
      await done()
    }
  })

  it('la sonda de antes falla ⇒ unverifiable (y el clic se entrega igual)', async () => {
    const { mcp, done } = await bootMac({ shots: [A, FAIL] })
    try {
      await shot(mcp)
      const r = await call(mcp, 'left_click', { x: 100, y: 100 })
      expect(r.isError, textOf(r)).not.toBe(true)
      expect(firstLine(r)).toMatch(/^efecto: unverifiable — se entregó; no se pudo comparar/)
      expect(clicks(mcp)).toHaveLength(1)
    } finally {
      await done()
    }
  })

  it('cliente de escritorio remoto al frente ⇒ espera más larga (~4 s) y lo dice', async () => {
    const { mcp, done } = await bootMac({ front: REMOTA })
    try {
      await shot(mcp, SES, 'Windows App')
      const { r, ms } = await timed(() => call(mcp, 'left_click', { x: 100, y: 100 }))
      expect(firstLine(r)).toContain('suspected_noop')
      expect(firstLine(r)).toContain('(escritorio remoto)')
      expect(ms).toBeGreaterThan(3800)
    } finally {
      await done()
    }
  })

  it('type_text: lectura de vuelta por accesibilidad ⇒ confirmed (aunque la ventana no cambie); sin lectura previa distinta no se inventa', async () => {
    // find-elements: [lista de app_screenshot, lectura de antes, lectura de después].
    const { mcp, done } = await bootMac({
      responses: { 'find-elements': [{ out: [] }, { out: [FIELD('')] }, { out: [FIELD('hola mundo')] }] }
    })
    try {
      await shot(mcp)
      const r = await call(mcp, 'type_text', { text: 'hola mundo', input: 'unicode' })
      expect(r.isError, textOf(r)).not.toBe(true)
      expect(firstLine(r)).toMatch(/^efecto: confirmed — un campo de la app contiene el texto escrito/)
      expect(typed(mcp)).toEqual(['hola mundo'])
      // Lo leído de los campos NO llega al modelo.
      expect(textOf(r)).not.toContain('screenPoint')
    } finally {
      await done()
    }
    // El texto YA estaba en el campo antes y sigue igual ⇒ no cuenta como confirmación (la ventana tampoco cambió).
    const b = await bootMac({
      responses: { 'find-elements': [{ out: [] }, { out: [FIELD('hola mundo')] }, { out: [FIELD('hola mundo')] }] }
    })
    try {
      await shot(b.mcp)
      const r = await call(b.mcp, 'type_text', { text: 'hola mundo', input: 'unicode' })
      expect(firstLine(r)).toContain('suspected_noop')
      expect(firstLine(r)).not.toContain('confirmed')
    } finally {
      await b.done()
    }
  })

  it('type_text en un cliente remoto: sin lectura de vuelta y la escalada es input: "paste"', async () => {
    const { mcp, done } = await bootMac({ front: REMOTA })
    try {
      await shot(mcp, SES, 'Windows App')
      // `input: "unicode"` evita el binario de teclas físicas, que no existe en la prueba.
      const r = await call(mcp, 'type_text', { text: 'hola', input: 'unicode' })
      expect(firstLine(r)).toContain('suspected_noop')
      expect(firstLine(r)).toContain('prueba input: "paste" y comprueba con zoom')
      // Ninguna consulta de accesibilidad con el texto (solo la lista de la captura, sin query).
      expect(mcp.calls().filter((c) => c.cmd === 'find-elements' && c.args.includes('--query'))).toEqual([])
    } finally {
      await done()
    }
  })

  it('right_click sin cambios ⇒ unverifiable (los menús son otra ventana); key con ctrl igual; key return sin cambios ⇒ suspected_noop; mouse_move sin veredicto', async () => {
    const { mcp, done } = await bootMac()
    try {
      await shot(mcp)
      const rc = await call(mcp, 'right_click', { x: 100, y: 100 })
      expect(firstLine(rc)).toMatch(/^efecto: unverifiable — los menús emergentes son otra ventana/)
      const kc = await call(mcp, 'key', { keys: 'ctrl+c' })
      expect(firstLine(kc)).toMatch(/^efecto: unverifiable — una combinación con cmd\/ctrl/)
      const kr = await call(mcp, 'key', { keys: 'return' })
      expect(firstLine(kr)).toContain('suspected_noop')
      const mm = await call(mcp, 'mouse_move', { x: 100, y: 100 })
      expect(textOf(mm)).not.toContain('efecto:')
      expect(textOf(mm)).toContain('Puntero movido')
    } finally {
      await done()
    }
  })

  it('screenshot: false apaga las sondas (sin veredicto y sin llamadas de sonda); COMPUTER_VERDICT=0 también', async () => {
    const a = await bootMac()
    try {
      await shot(a.mcp)
      const antes = shotCalls(a.mcp).length
      const r = await call(a.mcp, 'left_click', { x: 100, y: 100, screenshot: false })
      expect(textOf(r)).not.toContain('efecto:')
      expect(clicks(a.mcp)).toHaveLength(1)
      expect(shotCalls(a.mcp)).toHaveLength(antes)
    } finally {
      await a.done()
    }
    const b = await bootMac({ verdict: false })
    try {
      await shot(b.mcp)
      const antes = shotCalls(b.mcp).length
      const r = await call(b.mcp, 'left_click', { x: 100, y: 100 })
      expect(textOf(r)).not.toContain('efecto:')
      expect(shotCalls(b.mcp)).toHaveLength(antes)
    } finally {
      await b.done()
    }
  })

  it('screenshot: true devuelve la VENTANA de la app concedida (nunca pantalla completa), tras el veredicto, y renueva la captura', async () => {
    const { mcp, done } = await bootMac({ shots: [A, A, B], responses: { 'find-elements': { out: [BUTTON] } } })
    try {
      const id = await shot(mcp)
      const r = await call(mcp, 'left_click', { x: 100, y: 100, screenshot: true })
      expect(r.isError, textOf(r)).not.toBe(true)
      expect(firstLine(r)).toMatch(/^efecto: /)
      expect(hasImage(r)).toBe(true)
      expect(textOf(r)).toMatch(/Ventana de Notes: \d+x\d+ px/)
      const newId = Number(/Captura #(\d+)/.exec(textOf(r))?.[1] ?? 0)
      expect(id).toBeGreaterThan(0)
      // La captura nueva renueva la lista de elementos: lleva otro número.
      expect(newId).toBeGreaterThan(id)
      const last = shotCalls(mcp).at(-1)!
      expect(last.args[0]).toBe('com.apple.Notes')
      expect(last.args[2]).toBe('0')
      expect(mcp.calls().some((c) => /^screenshot/.test(c.cmd) || c.cmd === 'screenshot-sck')).toBe(false)
    } finally {
      await done()
    }
  })

  it('screenshot: true sin ventana concedida vigente (open_application sin captura previa) ⇒ sin imagen y sin tocar la pantalla', async () => {
    const { mcp, done } = await bootMac()
    try {
      const r = await call(mcp, 'open_application', { name: 'Notes', screenshot: true })
      expect(hasImage(r)).toBe(false)
      expect(textOf(r)).toContain('(sin captura:')
      expect(mcp.calls().some((c) => /^screenshot/.test(c.cmd) || c.cmd === 'screenshot-sck')).toBe(false)
    } finally {
      await done()
    }
  })

  it('batch da UN solo veredicto (en la primera línea) y sus pasos no llevan el suyo', async () => {
    const { mcp, done } = await bootMac({ shots: [A, A, B] })
    try {
      await shot(mcp)
      const r = await call(mcp, 'batch', {
        actions: [
          { tool: 'left_click', args: { x: 100, y: 100 } },
          { tool: 'key', args: { keys: 'return' } }
        ]
      })
      expect(r.isError, textOf(r)).not.toBe(true)
      expect(firstLine(r)).toMatch(/^efecto: unverifiable/)
      expect(textOf(r).match(/efecto:/g)).toHaveLength(1)
      expect(textOf(r)).toContain('Lote completo (2 pasos)')
    } finally {
      await done()
    }
  })

  it('una acción rechazada no lleva veredicto: sale el rechazo de siempre', async () => {
    const { mcp, done } = await bootMac()
    try {
      const r = await call(mcp, 'left_click', { x: 100, y: 100 })
      expect(r.isError).toBe(true)
      expect(textOf(r)).toMatch(/^\[rechazo: no-capture\]/)
      expect(textOf(r)).not.toContain('efecto:')
      expect(clicks(mcp)).toEqual([])
    } finally {
      await done()
    }
  })

  it('invalida la lista de elementos cuando algo cambió; si la acción no hizo nada, la lista sigue valiendo', async () => {
    // Sin cambios (todo A): la lista sigue valiendo y element: 1 funciona después.
    const a = await bootMac({ responses: { 'find-elements': { out: [BUTTON] } } })
    try {
      const id = await shot(a.mcp)
      const r1 = await call(a.mcp, 'left_click', { x: 100, y: 100 })
      expect(firstLine(r1)).toContain('suspected_noop')
      const r2 = await call(a.mcp, 'left_click', { element: 1, capture: id })
      expect(r2.isError, textOf(r2)).not.toBe(true)
      expect(clicks(a.mcp)).toHaveLength(2)
    } finally {
      await a.done()
    }
    // Con cambio: la lista se da por mala y element: 1 se rechaza sin clic.
    const b = await bootMac({ shots: [A, A, B], responses: { 'find-elements': { out: [BUTTON] } } })
    try {
      const id = await shot(b.mcp)
      const r1 = await call(b.mcp, 'left_click', { x: 100, y: 100 })
      expect(firstLine(r1)).toContain('unverifiable')
      const r2 = await call(b.mcp, 'left_click', { element: 1, capture: id })
      expect(r2.isError).toBe(true)
      expect(textOf(r2)).toMatch(/^\[rechazo: stale\]/)
      expect(clicks(b.mcp)).toHaveLength(1)
    } finally {
      await b.done()
    }
  })

  it('fuera del origen aislado no hay veredicto ni sondas (la respuesta de siempre)', async () => {
    const { mcp, done } = await bootMac({ isolated: false })
    try {
      const r = await mcp.call('left_click', { x: 10, y: 10, lazunox_session: SES })
      expect(textOf(r)).not.toContain('efecto:')
      expect(shotCalls(mcp)).toEqual([])
    } finally {
      await done()
    }
  })
})

describe.skipIf(!posixOnly)('foco al teclear (macOS)', () => {
  const longText = (n: number): string => Array.from({ length: n }, (_, i) => String.fromCharCode(97 + (i % 26))).join('')

  it('type_text se parte en trozos de ≤200 caracteres y los trozos, unidos, son EXACTAMENTE el texto (emoji, acentos y saltos incluidos)', async () => {
    const { mcp, done } = await bootMac({ verdict: false })
    try {
      // El emoji (2 unidades) cae justo en la frontera de 200: no se parte; «é» combinado y «\r\n» tampoco.
      const text = `${'a'.repeat(199)}👍${longText(150)}e\u0301\r\nfin\n${'z'.repeat(120)}`
      const r = await call(mcp, 'type_text', { text, input: 'unicode' })
      expect(r.isError, textOf(r)).not.toBe(true)
      const chunks = typed(mcp)
      expect(chunks.length).toBeGreaterThan(2)
      expect(chunks.join('')).toBe(text)
      for (const c of chunks) {
        expect(c.length).toBeLessThanOrEqual(200)
        // Ningún trozo corta un par sustituto.
        expect(c).not.toMatch(/[\ud800-\udbff]$/)
        expect(c).not.toMatch(/^[\udc00-\udfff]/)
      }
      expect(textOf(r)).toContain(`Escrito: ${text.length} caracteres`)
    } finally {
      await done()
    }
  })

  it('el foco cambia antes del 2.º trozo ⇒ solo se escribió el 1.º, [rechazo: focus-stolen] con los números, aviso a main y sin más escritura', async () => {
    // Llamadas a frontmost: requireTier, recheck previo, comprobación entre el 1.º y el 2.º trozo (→ otra app).
    const { mcp, side, done } = await bootMac({ verdict: false, front: [NOTES, NOTES, OTRA] })
    try {
      const text = longText(450)
      const r = await call(mcp, 'type_text', { text, input: 'unicode' })
      expect(r.isError).toBe(true)
      expect(textOf(r)).toMatch(/^\[rechazo: focus-stolen\]/)
      expect(textOf(r)).toContain('Se escribieron 200 de 450 caracteres')
      expect(textOf(r)).toContain('«Otra»')
      expect(typed(mcp)).toEqual([text.slice(0, 200)])
      await vi.waitFor(() => expect(reasons(side)).toContain('focus-stolen'))
    } finally {
      await done()
    }
  })

  it('la captura vigente se invalida tras un focus-stolen (hay que capturar de nuevo antes de otro clic)', async () => {
    const { mcp, done } = await bootMac({ verdict: false, front: [NOTES, NOTES, OTRA, NOTES] })
    try {
      await shot(mcp)
      const r = await call(mcp, 'type_text', { text: longText(300), input: 'unicode' })
      expect(textOf(r)).toMatch(/^\[rechazo: focus-stolen\]/)
      const c = await call(mcp, 'left_click', { x: 100, y: 100 })
      expect(textOf(c)).toMatch(/^\[rechazo: no-capture\]/)
      expect(clicks(mcp)).toEqual([])
    } finally {
      await done()
    }
  })

  it('el foco cambia justo al terminar ⇒ ya está escrito: aviso (no se puede deshacer), no error', async () => {
    const { mcp, done } = await bootMac({ verdict: false, front: [NOTES, NOTES, OTRA] })
    try {
      const r = await call(mcp, 'type_text', { text: 'hola', input: 'unicode' })
      expect(r.isError, textOf(r)).not.toBe(true)
      expect(typed(mcp)).toEqual(['hola'])
      expect(textOf(r)).toContain('Aviso: al terminar, la app al frente es «Otra»')
    } finally {
      await done()
    }
  })

  it('key: si tras pulsar cambió la app al frente, aviso en el texto; si no, el texto de siempre', async () => {
    const a = await bootMac({ verdict: false, front: [NOTES, NOTES, OTRA] })
    try {
      // frontmost: requireTier, recheckFront y la comprobación de después (sin binario de teclas físicas no hay una consulta de cliente remoto).
      const r = await call(a.mcp, 'key', { keys: 'return' })
      expect(r.isError, textOf(r)).not.toBe(true)
      expect(textOf(r)).toContain('Teclas pulsadas: return')
      expect(textOf(r)).toContain('Aviso: tras actuar, la app al frente es «Otra»')
    } finally {
      await a.done()
    }
    const b = await bootMac({ verdict: false })
    try {
      const r = await call(b.mcp, 'key', { keys: 'return' })
      expect(textOf(r)).toBe('Teclas pulsadas: return')
    } finally {
      await b.done()
    }
  })

  it('fuera del origen aislado type_text sigue siendo UNA sola llamada al helper (sin trozos)', async () => {
    const { mcp, done } = await bootMac({ isolated: false, verdict: false })
    try {
      const text = longText(450)
      const r = await mcp.call('type_text', { text, input: 'unicode', lazunox_session: SES })
      expect(r.isError, textOf(r)).not.toBe(true)
      expect(typed(mcp)).toEqual([text])
    } finally {
      await done()
    }
  })
})

describe.skipIf(!posixOnly)('wait con condición (macOS)', () => {
  it('until_text que aparece a la 3.ª consulta ⇒ confirmed al momento (no espera todos los segundos) y da la ficha del elemento', async () => {
    const { mcp, done } = await bootMac({
      responses: { 'find-elements': [{ out: [] }, { out: [] }, { out: [] }, { out: [BUTTON] }] }
    })
    try {
      // La 1.ª respuesta la consume la lista de elementos de app_screenshot.
      await shot(mcp)
      const { r, ms } = await timed(() => call(mcp, 'wait', { seconds: 15, until_text: 'Listo', app: 'Notes' }))
      expect(r.isError, textOf(r)).not.toBe(true)
      expect(firstLine(r)).toMatch(/^efecto: confirmed — apareció «Listo» en Notes/)
      expect(textOf(r)).toMatch(/\[AXButton\] "Listo" en \(\d+, \d+\) px/)
      expect(mcp.calls().filter((c) => c.cmd === 'find-elements' && c.args.includes('--query'))).toHaveLength(3)
      expect(ms).toBeGreaterThan(900)
      expect(ms).toBeLessThan(4000)
    } finally {
      await done()
    }
  })

  it('until_text que nunca aparece ⇒ unverifiable al agotar el tiempo (sondeo cada ~500 ms, sin pausa fija larga)', async () => {
    const { mcp, done } = await bootMac()
    try {
      const { r, ms } = await timed(() => call(mcp, 'wait', { seconds: 1.2, until_text: 'NoExiste', app: 'Notes' }))
      expect(r.isError, textOf(r)).not.toBe(true)
      expect(firstLine(r)).toMatch(/^efecto: unverifiable — no apareció «NoExiste» en 1\.2 s/)
      const q = mcp.calls().filter((c) => c.cmd === 'find-elements' && c.args.includes('--query'))
      expect(q.length).toBeGreaterThanOrEqual(2)
      expect(q.length).toBeLessThanOrEqual(5)
      expect(ms).toBeGreaterThan(1000)
      expect(ms).toBeLessThan(3500)
    } finally {
      await done()
    }
  })

  it('until_text exige el nivel de la app: sin concesión ⇒ [rechazo: no-grant] y NINGUNA consulta de accesibilidad; con «ver» vale', async () => {
    const a = await bootMac({ tier: () => null })
    try {
      const r = await call(a.mcp, 'wait', { seconds: 2, until_text: 'Listo', app: 'Notes' })
      expect(r.isError).toBe(true)
      expect(textOf(r)).toMatch(/^\[rechazo: no-grant\]/)
      expect(a.mcp.calls().some((c) => c.cmd === 'find-elements')).toBe(false)
    } finally {
      await a.done()
    }
    const b = await bootMac({ tier: () => 'view', responses: { 'find-elements': { out: [BUTTON] } } })
    try {
      const r = await call(b.mcp, 'wait', { seconds: 2, until_text: 'Listo', app: 'Notes' })
      expect(firstLine(r)).toContain('efecto: confirmed')
    } finally {
      await b.done()
    }
  })

  it('until_text sin app ni captura previa ⇒ [rechazo: no-capture]; texto demasiado largo ⇒ error', async () => {
    const { mcp, done } = await bootMac()
    try {
      const r = await call(mcp, 'wait', { seconds: 1, until_text: 'x' })
      expect(r.isError).toBe(true)
      expect(textOf(r)).toMatch(/^\[rechazo: no-capture\]/)
      const long = await call(mcp, 'wait', { seconds: 1, until_text: 'x'.repeat(201), app: 'Notes' })
      expect(long.isError).toBe(true)
      expect(mcp.calls().some((c) => c.cmd === 'find-elements')).toBe(false)
    } finally {
      await done()
    }
  })

  it('until_change: vuelve en cuanto la ventana cambia (confirmed con %), y la lista de elementos anterior queda invalidada', async () => {
    // window-shot: [app_screenshot, sonda de antes, sin cambio, cambio].
    const { mcp, done } = await bootMac({ shots: [A, A, A, B], responses: { 'find-elements': { out: [BUTTON] } } })
    try {
      const id = await shot(mcp)
      const { r, ms } = await timed(() => call(mcp, 'wait', { seconds: 10, until_change: true }))
      expect(firstLine(r)).toMatch(/^efecto: confirmed — la ventana de Notes cambió ~\d+ %/)
      expect(ms).toBeLessThan(4000)
      const c = await call(mcp, 'left_click', { element: 1, capture: id })
      expect(textOf(c)).toMatch(/^\[rechazo: stale\]/)
    } finally {
      await done()
    }
  })

  it('until_change que nunca ocurre ⇒ unverifiable; sin condición wait es la pausa de siempre (tope 10 s)', async () => {
    const { mcp, done } = await bootMac()
    try {
      const r = await call(mcp, 'wait', { seconds: 1, until_change: true, app: 'Notes' })
      expect(firstLine(r)).toMatch(/^efecto: unverifiable — no apareció un cambio en la ventana en 1 s/)
      const plain = await call(mcp, 'wait', { seconds: 0.2 })
      expect(textOf(plain)).toBe('Esperado 0.2s')
    } finally {
      await done()
    }
  })

  it('fuera del origen aislado until_text/until_change/app se ignoran (pausa fija de siempre)', async () => {
    const { mcp, done } = await bootMac({ isolated: false })
    try {
      const r = await mcp.call('wait', { seconds: 0.2, until_text: 'x', until_change: true, app: 'Notes', lazunox_session: SES })
      expect(textOf(r)).toBe('Esperado 0.2s')
      expect(mcp.calls().some((c) => c.cmd === 'find-elements' || c.cmd === 'window-shot')).toBe(false)
    } finally {
      await done()
    }
  })
})

describe.skipIf(!posixOnly)('revisión de seguridad de T6 (macOS)', () => {
  const find = (m: McpProc): number => m.calls().filter((c) => c.cmd === 'find-elements' && c.args.includes('--query')).length
  const lento = (ms: number, then: unknown): unknown => ({ sleepMs: ms, then })

  it('M1: se revoca la app a mitad de un wait until_text ⇒ sale pronto con [rechazo: no-grant], sin ficha ni «confirmed»', async () => {
    let revoked = false
    const { mcp, done } = await bootMac({
      tier: () => (revoked ? null : 'view'),
      // La lectura tarda 0,9 s: la concesión se retira mientras se lee y el resultado ya no debe usarse.
      responses: { 'find-elements': lento(900, { out: [BUTTON] }) }
    })
    try {
      setTimeout(() => (revoked = true), 450)
      const { r, ms } = await timed(() => call(mcp, 'wait', { seconds: 15, until_text: 'Listo', app: 'Notes' }))
      expect(r.isError).toBe(true)
      expect(textOf(r)).toMatch(/^\[rechazo: no-grant\]/)
      expect(textOf(r)).not.toMatch(/confirmed|AXButton|Listo» en/)
      expect(ms).toBeLessThan(5000)
      // Y no vuelve a preguntar por el árbol de accesibilidad.
      const n = find(mcp)
      await new Promise((res) => setTimeout(res, 1300))
      expect(find(mcp)).toBe(n)
    } finally {
      await done()
    }
  })

  it('M1: se revoca la app entre vueltas de un wait until_change ⇒ no-grant y deja de sondear', async () => {
    let revoked = false
    const { mcp, done } = await bootMac({ tier: () => (revoked ? null : 'view') })
    try {
      setTimeout(() => (revoked = true), 700)
      const r = await call(mcp, 'wait', { seconds: 15, until_change: true, app: 'Notes' })
      expect(r.isError).toBe(true)
      expect(textOf(r)).toMatch(/^\[rechazo: no-grant\]/)
      const n = shotCalls(mcp).length
      await new Promise((res) => setTimeout(res, 1200))
      expect(shotCalls(mcp).length).toBe(n)
    } finally {
      await done()
    }
  })

  it('M1: Detener a mitad de un wait ⇒ error de detención y el bucle no sigue sondeando', async () => {
    let stopped = false
    const { mcp, done } = await bootMac({ stopped: () => stopped })
    try {
      setTimeout(() => (stopped = true), 900)
      const r = await call(mcp, 'wait', { seconds: 15, until_text: 'NoExiste', app: 'Notes' })
      expect(r.isError).toBe(true)
      expect(textOf(r)).toContain('Control detenido')
      await new Promise((res) => setTimeout(res, 1500))
      const n = find(mcp)
      await new Promise((res) => setTimeout(res, 1500))
      expect(find(mcp)).toBe(n)
    } finally {
      await done()
    }
  })

  it('B1: una sonda colgada cuenta como fallida ⇒ unverifiable en pocos segundos (no 30 s)', async () => {
    // app_screenshot normal, sonda de antes normal y la de después se cuelga 10 s.
    const { mcp, done } = await bootMac({ shots: [A, A, lento(10_000, B)] })
    try {
      await shot(mcp)
      const { r, ms } = await timed(() => call(mcp, 'left_click', { x: 100, y: 100 }))
      expect(r.isError, textOf(r)).not.toBe(true)
      expect(firstLine(r)).toMatch(/^efecto: unverifiable — se entregó; no se pudo comparar la ventana/)
      expect(ms).toBeLessThan(4000)
      expect(clicks(mcp)).toHaveLength(1)
    } finally {
      await done()
    }
  })

  it('B1: el plazo de wait until_change incluye lo que tardan las sondas (1 s ⇒ ~1 s, no 1 s + sondas colgadas)', async () => {
    const { mcp, done } = await bootMac({ shots: [lento(10_000, A)] })
    try {
      const { r, ms } = await timed(() => call(mcp, 'wait', { seconds: 1, until_change: true, app: 'Notes' }))
      expect(firstLine(r)).toMatch(/^efecto: unverifiable — no apareció un cambio en la ventana en 1 s/)
      expect(ms).toBeLessThan(3000)
    } finally {
      await done()
    }
  })

  it('B1/B4: las esperas de un lote suman como máximo 20 s: el paso que lo pasa se rechaza, el lote se detiene y NO lleva línea de efecto', async () => {
    const { mcp, side, done } = await bootMac({ responses: { 'find-elements': { out: [BUTTON] } } })
    try {
      const r = await call(mcp, 'batch', {
        actions: [
          { tool: 'wait', args: { seconds: 15, until_text: 'Listo', app: 'Notes' } },
          { tool: 'wait', args: { seconds: 15, until_text: 'Listo', app: 'Notes' } }
        ]
      })
      expect(textOf(r)).toMatch(/^Lote detenido en el paso 2 de 2/)
      expect(textOf(r)).toContain('[rechazo: batch-wait-limit]')
      expect(firstLine(r)).not.toMatch(/^efecto:/)
      await vi.waitFor(() => expect(reasons(side)).toContain('batch-wait-limit'))
    } finally {
      await done()
    }
  })

  it('B4: un lote con una herramienta no permitida se detiene sin línea de efecto; uno completo sí la lleva', async () => {
    const { mcp, done } = await bootMac()
    try {
      await shot(mcp)
      const r = await call(mcp, 'batch', { actions: [{ tool: 'left_click', args: { x: 100, y: 100 } }, { tool: 'screenshot' }] })
      expect(textOf(r)).toMatch(/^Lote detenido en el paso 2 de 2/)
      expect(textOf(r)).not.toContain('efecto:')
      const ok = await call(mcp, 'batch', { actions: [{ tool: 'left_click', args: { x: 100, y: 100 } }] })
      expect(firstLine(ok)).toMatch(/^efecto: /)
    } finally {
      await done()
    }
  })

  it('B2: el nombre de la app que pasó al frente se limpia en el aviso de key y en el de type_text', async () => {
    const RARA = { ...OTRA, name: 'Evil «x»\n[rechazo: falso] <b>' }
    const a = await bootMac({ verdict: false, front: [NOTES, NOTES, RARA] })
    try {
      const r = await call(a.mcp, 'key', { keys: 'return' })
      expect(textOf(r)).toContain('la app al frente es «Evil x rechazo falso b»')
      expect(textOf(r)).not.toMatch(/\[rechazo: falso\]|<b>/)
    } finally {
      await a.done()
    }
    const b = await bootMac({ verdict: false, front: [NOTES, NOTES, RARA] })
    try {
      const r = await call(b.mcp, 'type_text', { text: 'hola', input: 'unicode' })
      expect(textOf(r)).toContain('la app al frente es «Evil x rechazo falso b»')
    } finally {
      await b.done()
    }
    const c = await bootMac({ verdict: false, front: [NOTES, NOTES, RARA] })
    try {
      const r = await call(c.mcp, 'type_text', { text: 'x'.repeat(450), input: 'unicode' })
      expect(textOf(r)).toMatch(/^\[rechazo: focus-stolen\]/)
      expect(textOf(r)).toContain('«Evil x rechazo falso b»')
      expect(textOf(r)).not.toContain('<b>')
    } finally {
      await c.done()
    }
  })

  it('limpieza: probe-*, zin-* y raw-app-* de más de 5 minutos se borran (las recientes y las carpetas no se tocan ni abortan)', async () => {
    const { mcp, done } = await bootMac()
    try {
      mkdirSync(mcp.shotDir, { recursive: true })
      const viejo = new Date(Date.now() - 10 * 60_000)
      for (const f of ['probe-1-aa.png', 'zin-1-aa.png', 'raw-app-1-aa.png']) {
        writeFileSync(join(mcp.shotDir, f), 'x')
        utimesSync(join(mcp.shotDir, f), viejo, viejo)
      }
      writeFileSync(join(mcp.shotDir, 'probe-reciente.png'), 'x')
      mkdirSync(join(mcp.shotDir, 'probe-carpeta'))
      utimesSync(join(mcp.shotDir, 'probe-carpeta'), viejo, viejo)
      await shot(mcp)
      const left = readdirSync(mcp.shotDir)
      expect(left).not.toContain('probe-1-aa.png')
      expect(left).not.toContain('zin-1-aa.png')
      expect(left).not.toContain('raw-app-1-aa.png')
      expect(left).toContain('probe-reciente.png')
    } finally {
      await done()
    }
  })
})

describe.skipIf(!posixOnly)('veredicto y foco en Windows (helper falso)', () => {
  const NOTEPAD = 'exe:c:\\windows\\system32\\notepad.exe|pub:microsoft windows'
  const WNOTE = { name: 'Bloc de notas', bundleId: NOTEPAD, pid: 2 }
  const WOTRA = { name: 'Calculadora', bundleId: 'exe:c:\\windows\\system32\\calc.exe|pub:microsoft windows', pid: 3 }
  const WFRAME = rect(100, 100, 800, 600)
  const wshot = (png: Buffer): unknown => ({
    writeImage: true,
    imageB64: b64(png),
    probeB64: b64(png),
    out: {
      ok: true,
      width: 800,
      height: 600,
      title: 'Sin título',
      x: 100,
      y: 100,
      srcWidth: 800,
      srcHeight: 600,
      frame: WFRAME,
      covered: [],
      coveredPct: 0
    }
  })

  async function bootWin(shots: unknown[], front: unknown = WNOTE): Promise<{ mcp: McpProc; done: () => Promise<void> }> {
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
          screens: { out: [{ width: 1920, height: 1080, scale: 1, x: 0, y: 0, main: true }] },
          frontmost: Array.isArray(front) ? front.map((f) => ({ out: f })) : { out: front },
          'app-at': { out: WNOTE },
          'list-apps': { out: [{ name: 'Bloc de notas', appKey: NOTEPAD, pid: 2 }] },
          'windows-of': { out: [{ title: 'Sin título', ...WFRAME }] },
          'find-elements': { out: [] },
          'window-shot': shots
        }
      },
      env: {
        COMPUTER_BACKEND: 'win32',
        CU_HELPER_ARGV0: 'node',
        COMPUTER_AUTO_SCREENSHOT: '0',
        COMPUTER_INSTANT: '1',
        COMPUTER_VERDICT: '1'
      }
    })
    return {
      mcp,
      done: async () => {
        await mcp.stop()
        await side.close()
      }
    }
  }

  it('sondas iguales ⇒ suspected_noop; distintas ⇒ unverifiable con el %; la sonda (--max-long 256) se borra', async () => {
    const a = await bootWin([wshot(PNG_A)])
    try {
      expect((await call(a.mcp, 'app_screenshot', { app: 'notepad' })).isError).not.toBe(true)
      const r = await call(a.mcp, 'left_click', { x: 100, y: 100 })
      expect(r.isError, textOf(r)).not.toBe(true)
      expect(firstLine(r)).toContain('efecto: suspected_noop')
      expect(a.mcp.calls().filter((c) => c.cmd === 'click')).toHaveLength(1)
      expect(a.mcp.calls().filter((c) => c.cmd === 'window-shot' && c.args.includes('256')).length).toBeGreaterThanOrEqual(2)
      expect(probeFiles(a.mcp)).toEqual([])
    } finally {
      await a.done()
    }
    const b = await bootWin([wshot(PNG_A), wshot(PNG_A), wshot(PNG_B)])
    try {
      await call(b.mcp, 'app_screenshot', { app: 'notepad' })
      const r = await call(b.mcp, 'left_click', { x: 100, y: 100 })
      expect(firstLine(r)).toMatch(/^efecto: unverifiable — se entregó; la ventana cambió ~\d+ %/)
    } finally {
      await b.done()
    }
  })

  it('foco que cambia antes del 2.º trozo ⇒ [rechazo: focus-stolen] con solo el 1.º trozo escrito', async () => {
    const { mcp, done } = await bootWin([wshot(PNG_A)], [WNOTE, WNOTE, WOTRA])
    try {
      // `screenshot: false` apaga las sondas: así el guion de `frontmost` solo lo consumen las comprobaciones de foco.
      const text = 'x'.repeat(450)
      const r = await call(mcp, 'type_text', { text, screenshot: false })
      expect(r.isError).toBe(true)
      expect(textOf(r)).toMatch(/^\[rechazo: focus-stolen\]/)
      expect(textOf(r)).toContain('de 450 caracteres')
      expect(typed(mcp).join('').length).toBeLessThan(450)
    } finally {
      await done()
    }
  })
})
