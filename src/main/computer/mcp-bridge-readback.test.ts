/**
 * Modo de apps (origen aislado), con el helper FALSO: lectura de vuelta del CAMPO ENFOCADO tras `type_text` y `key`, y pre-chequeo de
 * `app_press` (elemento deshabilitado ⇒ `[rechazo: disabled]` sin enviar nada; pulsación hueca probable). Mejoras 1 y 2 de
 * `docs/ESTUDIO-CUA-HERMES.md`. Todo por señal observada (valor antes/después, `enabled`, `actions`), nunca por app.
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
import { BRIDGE_ORIGIN_HEADER, BRIDGE_SERVER_HEADER } from '../../shared/unified-bridge'
import { posixOnly } from '../../test/platform'

vi.setConfig({ testTimeout: 40_000 })

const work = tmpWork('lzx-mcp-readback')
let bundle = ''
beforeAll(() => {
  bundle = bundleMcp(work.dir)
})
afterAll(() => work.cleanup())

const HDRS = { [BRIDGE_ORIGIN_HEADER]: 'secreto-de-prueba', [BRIDGE_SERVER_HEADER]: '/Users/ana/proyecto' }
const SES = 'ses_0123456789abcdef'
const NOTES = { name: 'Notes', bundleId: 'com.apple.Notes', pid: 100 }
const MAIN = { width: 1512, height: 982, scale: 2, x: 0, y: 0, main: true }
const PNG_A = makePng(800, 600, 0x80)
const A = { writeImage: true, imageB64: PNG_A.toString('base64'), out: { ok: true, width: 800, height: 600, title: 'Ventana' } }

let seq = 0
async function boot(
  responses: Record<string, unknown>,
  isolated = true
): Promise<{ mcp: McpProc; side: SideChannel; done: () => Promise<void> }> {
  const side = await startSideChannel({
    planApproved: !isolated,
    bridgeCheck: () => (isolated ? { isolated: true, ok: true } : { isolated: false, ok: false }),
    tier: () => 'full'
  })
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
        'windows-of': { out: [{ title: 'V', x: 100, y: 100, width: 400, height: 300 }] },
        'window-shot': [A],
        frontmost: { out: NOTES },
        'app-at': { out: NOTES },
        'resolve-app': { out: { ...NOTES, found: true } },
        'find-elements': { out: [] },
        ...responses
      }
    },
    env: { COMPUTER_AUTO_SCREENSHOT: '0', COMPUTER_INSTANT: '1', COMPUTER_VERDICT: '1' }
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

const call = (m: McpProc, name: string, args: Record<string, unknown>) => m.call(name, { ...args, lazunox_session: SES }, HDRS)
const firstLine = (r: { content: Array<{ type: string; text?: string }> }): string => textOf(r).split('\n')[0]
const node = (o: Record<string, unknown> = {}): Record<string, unknown> => ({
  ref: 'w0.2.1',
  role: 'AXTextField',
  enabled: true,
  focused: true,
  frame: { x: 0, y: 0, width: 300, height: 100 },
  actions: [],
  ...o
})
const tree = (...nodes: Array<Record<string, unknown>>): unknown => ({ out: { app: {}, nodes, truncated: false } })
const field = (value: string, o: Record<string, unknown> = {}): unknown => tree(node({ value, ...o }))
const calls = (m: McpProc, cmd: string): string[][] =>
  m
    .calls()
    .filter((c) => c.cmd === cmd)
    .map((c) => c.args)

describe.skipIf(!posixOnly)('type_text: lectura de vuelta del campo enfocado', () => {
  it('el campo enfocado ahora contiene el texto ⇒ confirmed con motivo propio; lo leído no llega al modelo', async () => {
    const { mcp, done } = await boot({ 'ax-tree': [field(''), field('hola mundo')] })
    try {
      const r = await call(mcp, 'type_text', { text: 'hola mundo', input: 'unicode' })
      expect(r.isError, textOf(r)).not.toBe(true)
      expect(firstLine(r)).toMatch(/^efecto: confirmed — el campo enfocado contiene el texto escrito/)
      expect(calls(mcp, 'type')).toEqual([['hola mundo']])
    } finally {
      await done()
    }
  })

  it('solo llegó el comienzo ⇒ unverifiable con las cuentas (nunca confirmed, nunca suspected_noop) y sin contenido', async () => {
    const { mcp, done } = await boot({ 'ax-tree': [field(''), field('hola')] })
    try {
      const r = await call(mcp, 'type_text', { text: 'hola mundo', input: 'unicode' })
      expect(firstLine(r)).toMatch(/^efecto: unverifiable — .*el campo enfocado recibió solo 4 de 10 caracteres/)
      expect(firstLine(r)).not.toMatch(/«|hola/)
    } finally {
      await done()
    }
  })

  it('el campo no cambió ⇒ el veredicto de siempre (suspected_noop) con la nota; no se afirma de más', async () => {
    const { mcp, done } = await boot({ 'ax-tree': field('abc') })
    try {
      const r = await call(mcp, 'type_text', { text: 'hola mundo', input: 'unicode' })
      expect(firstLine(r)).toMatch(/^efecto: suspected_noop — .*el valor del campo enfocado no cambió/)
    } finally {
      await done()
    }
  })

  it('campo seguro: unverifiable y su valor no se lee ni se devuelve', async () => {
    const secret = 'clave-123'
    const sec = (v: string): unknown => tree(node({ role: 'AXSecureTextField', secure: true, value: v }))
    const { mcp, done } = await boot({ 'ax-tree': [sec(''), sec(secret)] })
    try {
      const r = await call(mcp, 'type_text', { text: secret, input: 'unicode' })
      expect(firstLine(r)).not.toContain('confirmed')
      expect(textOf(r)).not.toContain(`: ${secret}`)
    } finally {
      await done()
    }
  })

  it('sin lectura posible (el árbol falla) ⇒ nunca confirmed', async () => {
    const { mcp, done } = await boot({ 'ax-tree': { exit: 7, stderr: 'la app no está en ejecución' } })
    try {
      const r = await call(mcp, 'type_text', { text: 'hola mundo', input: 'unicode' })
      expect(r.isError, textOf(r)).not.toBe(true)
      expect(firstLine(r)).not.toContain('confirmed')
    } finally {
      await done()
    }
  })

  it('fuera del origen aislado no se lee el árbol', async () => {
    const { mcp, done } = await boot({ 'ax-tree': field('') }, false)
    try {
      const r = await mcp.call('type_text', { text: 'hola', input: 'unicode', lazunox_session: SES })
      expect(textOf(r)).not.toContain('efecto:')
      expect(calls(mcp, 'ax-tree')).toEqual([])
    } finally {
      await done()
    }
  })
})

describe.skipIf(!posixOnly)('key: lectura de vuelta del campo enfocado', () => {
  it('el valor del campo enfocado cambió ⇒ confirmed', async () => {
    const { mcp, done } = await boot({ 'ax-tree': [field('abc'), field('ab')] })
    try {
      const r = await call(mcp, 'key', { keys: 'backspace' })
      expect(r.isError, textOf(r)).not.toBe(true)
      expect(firstLine(r)).toMatch(/^efecto: confirmed — el valor del campo enfocado cambió tras la tecla/)
    } finally {
      await done()
    }
  })

  it('el campo igual ⇒ no se confirma (la ventana tampoco cambió: suspected_noop como siempre)', async () => {
    const { mcp, done } = await boot({ 'ax-tree': field('abc') })
    try {
      const r = await call(mcp, 'key', { keys: 'a' })
      expect(firstLine(r)).toMatch(/^efecto: suspected_noop/)
    } finally {
      await done()
    }
  })

  it('el foco pasó a otro campo ⇒ no se confirma por comparar campos distintos', async () => {
    const { mcp, done } = await boot({ 'ax-tree': [field('abc'), field('xyz', { ref: 'w0.9' })] })
    try {
      const r = await call(mcp, 'key', { keys: 'tab' })
      expect(firstLine(r)).not.toContain('confirmed')
    } finally {
      await done()
    }
  })
})

describe.skipIf(!posixOnly)('app_press: pre-chequeo de habilitado y pulsación hueca', () => {
  const REF = 'w0.2.1'
  const btn = (o: Record<string, unknown> = {}): unknown =>
    tree(node({ role: 'AXButton', title: 'Listo', focused: false, actions: ['AXPress'], ...o }))

  it('elemento deshabilitado ⇒ [rechazo: disabled] ANTES de enviar y se avisa a main', async () => {
    const { mcp, side, done } = await boot({ 'ax-tree': btn({ enabled: false }) })
    try {
      const r = await call(mcp, 'app_press', { app: 'Notes', ref: REF })
      expect(r.isError).toBe(true)
      expect(textOf(r)).toMatch(/^\[rechazo: disabled\] El elemento w0\.2\.1 está deshabilitado/)
      expect(textOf(r)).not.toContain('efecto:')
      expect(calls(mcp, 'ax-press')).toEqual([])
      // El aviso a main es «dispara y olvida»: se espera a que llegue.
      await vi.waitFor(() =>
        expect(side.requests.filter((q) => q.path === '/bridge-denied').map((q) => (q.body as { reason: string }).reason)).toEqual([
          'disabled'
        ])
      )
    } finally {
      await done()
    }
  })

  it('habilitado ⇒ se pulsa como siempre', async () => {
    const { mcp, done } = await boot({ 'ax-tree': [btn({ title: 'Mostrar' }), btn({ title: 'Ocultar' })] })
    try {
      const r = await call(mcp, 'app_press', { app: 'Notes', ref: REF })
      expect(firstLine(r)).toMatch(/^efecto: confirmed — el estado del elemento cambió/)
      expect(calls(mcp, 'ax-press')).toHaveLength(1)
    } finally {
      await done()
    }
  })

  it('el elemento no anunciaba AXPress y nada cambió ⇒ se pulsa pero el veredicto avisa de pulsación hueca probable', async () => {
    const { mcp, done } = await boot({ 'ax-tree': btn({ actions: ['AXShowMenu'] }) })
    try {
      const r = await call(mcp, 'app_press', { app: 'Notes', ref: REF })
      expect(calls(mcp, 'ax-press')).toHaveLength(1)
      expect(firstLine(r)).toMatch(/^efecto: (suspected_noop|unverifiable) — .*pulsación hueca probable/)
    } finally {
      await done()
    }
  })

  it('anunciaba AXPress y nada cambió ⇒ sin la nota de pulsación hueca', async () => {
    const { mcp, done } = await boot({ 'ax-tree': btn() })
    try {
      const r = await call(mcp, 'app_press', { app: 'Notes', ref: REF })
      expect(firstLine(r)).toMatch(/^efecto: suspected_noop/)
      expect(firstLine(r)).not.toContain('hueca')
    } finally {
      await done()
    }
  })

  it('fuera del origen aislado un elemento deshabilitado NO se rechaza aquí (el comportamiento de Control total no cambia)', async () => {
    const { mcp, done } = await boot({ 'ax-tree': btn({ enabled: false }) }, false)
    try {
      const r = await mcp.call('app_press', { app: 'Notes', ref: REF, lazunox_session: SES })
      expect(textOf(r)).toBe('Pulsado w0.2.1 en Notes.')
      expect(calls(mcp, 'ax-press')).toHaveLength(1)
    } finally {
      await done()
    }
  })
})
