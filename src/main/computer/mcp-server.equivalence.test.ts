/**
 * Caracterización del MCP de Control del Mac (plan C, C3): graba, con un helper FALSO y un canal lateral simulado, EXACTAMENTE
 * lo que el MCP le pide al helper nativo (comandos, argumentos, banderas, orden) y a main (eventos, consultas), y lo que
 * devuelve al modelo (textos de éxito y de error). El fixture `mcp-server.equivalence.fixture.json` se capturó ANTES de abstraer
 * la parte de plataforma (`mcp-platform-*.ts`): la abstracción no puede cambiar ni un byte de esto en macOS.
 * Regenerarlo solo a propósito: `UPDATE_CU_FIXTURE=1 npx vitest run src/main/computer/mcp-server.equivalence.test.ts` y después `npx prettier --write` sobre el fixture.
 *
 * Sin pantalla real: las capturas usan `COMPUTER_FAKE_SCREENSHOT` (el `screencapture` real nunca corre) y `sips` solo convierte un
 * PNG liso generado aquí. Las ramas ScreenCaptureKit/`screencapture`/máscara se cubren en `mcp-platform-darwin.test.ts` con dobles.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { macOnly } from '../../test/platform'
import {
  bundleMcp,
  FAKE_HELPER,
  makePng,
  startMcp,
  startSideChannel,
  textOf,
  tmpWork,
  type McpProc,
  type SideChannel
} from '../../test/cu-mcp-kit'

const FIXTURE = join(__dirname, 'mcp-server.equivalence.fixture.json')
const UPDATE = process.env.UPDATE_CU_FIXTURE === '1'

const work = tmpWork('lzx-mcp-eq')
let bundle = ''
const png = makePng(1440, 900)

type Step = { tool: string; args?: Record<string, unknown>; unordered?: boolean } | { rpc: string; params?: Record<string, unknown> }

interface Scenario {
  name: string
  steps: Step[]
  env?: Record<string, string>
  script?: Record<string, unknown>
  side?: Parameters<typeof startSideChannel>[0] | false
  helper?: string
}

const norm = (s: string, dir: string): string =>
  s
    .split(dir)
    .join('<DIR>')
    .replace(/(shot|raw)(-app)?-\d+-[a-z0-9]+\.(jpg|png)/g, '$1$2-<stamp>.$3')
    .replace(/Archivo: \S+/g, 'Archivo: <path>')

async function run(sc: Scenario): Promise<unknown> {
  const dir = join(work.dir, sc.name.replace(/\W+/g, '_'))
  let side: SideChannel | undefined
  if (sc.side !== false) side = await startSideChannel(sc.side ?? {})
  const mcp: McpProc = await startMcp({
    bundle,
    helper: sc.helper ?? FAKE_HELPER,
    dir,
    events: side,
    script: sc.script,
    image: png,
    env: {
      COMPUTER_FAKE_SCREENSHOT: join(dir, 'fake-image'),
      COMPUTER_AUTO_SCREENSHOT: '0',
      COMPUTER_INSTANT: '1',
      COMPUTER_TYPE_DELAY_MS: '7',
      ...sc.env
    }
  })
  const out: unknown[] = []
  try {
    for (const step of sc.steps) {
      const before = mcp.calls().length
      const sBefore = side?.requests.length ?? 0
      const aBefore = side?.actions().length ?? 0
      let res: unknown
      if ('rpc' in step) {
        const r = await mcp.rpc(step.rpc, step.params)
        res = JSON.parse(norm(JSON.stringify(r), dir))
      } else {
        const r = await mcp.call(step.tool, step.args)
        res = {
          isError: r.isError === true,
          text: norm(textOf(r), dir),
          parts: r.content.map((c) => c.type)
        }
      }
      await new Promise((r) => setTimeout(r, 80)) // los eventos `end` del canal lateral son fire-and-forget
      out.push({
        step,
        res,
        helper: mcp
          .calls()
          .slice(before)
          .map((c) => norm(JSON.stringify(c), dir))
          [
            // Llamadas en paralelo (`Promise.all` al resolver varias apps): el orden de llegada no es determinista.
            !('rpc' in step) && step.unordered ? 'sort' : 'slice'
          ](),
        actions: (side?.actions().slice(aBefore) ?? []).map((a) => JSON.stringify(a)),
        side: (side?.requests.slice(sBefore) ?? [])
          .filter((r) => r.path !== '/state' && !(r.method === 'POST' && r.path === '/'))
          .map((r) => `${r.method} ${r.path}?${new URLSearchParams(r.query).toString()}${r.body ? ' ' + JSON.stringify(r.body) : ''}`)
          .sort()
      })
    }
  } finally {
    await mcp.stop()
    await side?.close()
  }
  return out
}

const SCENARIOS: Scenario[] = [
  {
    name: 'protocolo-y-herramientas',
    side: false,
    steps: [
      { rpc: 'initialize', params: { protocolVersion: '2025-03-26' } },
      { rpc: 'tools/list' },
      { rpc: 'ping' },
      { rpc: 'resources/list' }
    ]
  },
  {
    name: 'pantalla-raton-teclado',
    steps: [
      { tool: 'screenshot' },
      { tool: 'left_click', args: { x: 100, y: 50 } },
      { tool: 'right_click', args: { x: 200.5, y: 300 } },
      { tool: 'double_click', args: { x: 10, y: 10, screenshot: false } },
      { tool: 'mouse_move', args: { x: 640, y: 400 } },
      { tool: 'drag', args: { start_x: 10, start_y: 20, end_x: 300, end_y: 400 } },
      { tool: 'scroll', args: { x: 500, y: 500, direction: 'down', amount: 3 } },
      { tool: 'scroll', args: { x: 500, y: 500, direction: 'up' } },
      { tool: 'scroll', args: { x: 500, y: 500, direction: 'sideways' } },
      { tool: 'type_text', args: { text: 'Hola\nmundo ñ' } },
      { tool: 'type_text', args: { text: '' } },
      { tool: 'key', args: { keys: 'cmd+space' } },
      { tool: 'key', args: { keys: 'cmd+shift+t return' } },
      { tool: 'cursor_position' },
      { tool: 'left_click', args: { x: 99999, y: 5 } },
      { tool: 'left_click', args: { x: 'a', y: 5 } },
      { tool: 'wait', args: { seconds: 0.05 } },
      { tool: 'herramienta_inexistente' }
    ]
  },
  {
    name: 'captura-automatica',
    env: { COMPUTER_AUTO_SCREENSHOT: '1' },
    steps: [
      { tool: 'left_click', args: { x: 100, y: 50 } },
      { tool: 'left_click', args: { x: 100, y: 50, screenshot: false } }
    ]
  },
  {
    name: 'abrir-aplicacion',
    steps: [
      { tool: 'open_application', args: { name: 'Notes', screenshot: false } },
      { tool: 'open_application', args: { name: '' } }
    ],
    script: { responses: { activate: { out: { ok: true, activated: true, hasWindow: false } } } }
  },
  {
    name: 'segundo-plano',
    side: { controlMode: { mode: 'background', foreground: false } },
    steps: [
      { tool: 'open_application', args: { name: 'Notes', screenshot: false } },
      { tool: 'left_click', args: { x: 1, y: 1 } },
      { tool: 'type_text', args: { text: 'x' } },
      { tool: 'request_full_control', args: { app: 'Notes', reason: 'arrastrar' } }
    ]
  },
  {
    name: 'accesibilidad-app',
    steps: [
      { tool: 'app_tree', args: { app: 'Notes', max_depth: 3, max_nodes: 50 } },
      { tool: 'app_find', args: { app: 'Notes', role: 'AXButton', title: 'Guardar', text: 'g', limit: 5 } },
      { tool: 'app_press', args: { app: 'Notes', ref: 'w0.1', expect_role: 'AXButton', expect_title: 'OK', screenshot: false } },
      { tool: 'app_set_value', args: { app: 'Notes', ref: 'w0.2', value: 'hola', expect_role: 'AXTextField', screenshot: false } },
      { tool: 'app_action', args: { app: 'Notes', ref: 'w0.3', action: 'AXRaise', screenshot: false } },
      { tool: 'app_action', args: { app: 'Notes', ref: 'w0.3', action: 'AXDelete' } },
      { tool: 'app_screenshot', args: { app: 'Notes', window: 1 } },
      { tool: 'find_element', args: { description: 'Guardar', appHint: 'Notes' } },
      { tool: 'list_elements', args: { appHint: 'Notes', role: 'button,textfield' } },
      { tool: 'teach_step', args: { text: 'Aquí', app: 'Notes', ref: 'w0.1' } },
      { tool: 'teach_step', args: { text: 'Allá', x: 100, y: 100 } },
      { tool: 'teach_end' }
    ],
    script: {
      responses: {
        'ax-find': { out: { matches: [{ ref: 'w0.2', role: 'AXTextField' }] } },
        'find-elements': {
          out: [
            {
              role: 'button',
              title: 'Guardar',
              enabled: true,
              x: 1,
              y: 2,
              width: 30,
              height: 20,
              screenPoint: { x: 16, y: 12 }
            }
          ]
        }
      }
    }
  },
  {
    name: 'plan-y-concesiones',
    steps: [
      { tool: 'request_access', args: { plan: ['Abrir Notas'], apps: ['Notes'], levels: ['full'], reason: 'prueba', screenshot: false } },
      { tool: 'request_access', args: { apps: [] } },
      { tool: 'request_access', unordered: true, args: { apps: [{ name: 'com.apple.Notes', level: 'view' }, 'Notes'], levels: ['click'] } }
    ]
  },
  {
    name: 'rechazos-de-seguridad',
    side: { tier: (k) => (k === 'com.apple.Notes' ? 'view' : null) },
    steps: [
      { tool: 'left_click', args: { x: 100, y: 50 } },
      { tool: 'type_text', args: { text: 'x' } },
      { tool: 'app_press', args: { app: 'Notes', ref: 'w0.1' } },
      { tool: 'app_tree', args: { app: 'Notes' } }
    ]
  },
  {
    name: 'campo-seguro-y-tecleo-reciente',
    script: {
      responses: {
        'focused-secure': [{ out: { secure: true } }, { out: { secure: false } }],
        'recent-input': { out: { keyDownSeconds: 0.4 } }
      }
    },
    steps: [
      { tool: 'type_text', args: { text: 'x' } },
      { tool: 'key', args: { keys: 'return' } }
    ]
  },
  {
    name: 'codigos-de-salida-del-helper',
    script: {
      responses: {
        'ax-tree': [{ exit: 2, stderr: 'sin permiso' }, { exit: 7 }, { exit: 12 }, { exit: 99 }],
        'ax-press': { exit: 8 },
        'ax-set-value': { exit: 9 },
        'ax-action': { exit: 11 },
        'window-shot': { exit: 5 }
      }
    },
    steps: [
      { tool: 'app_tree', args: { app: 'Notes' } },
      { tool: 'app_tree', args: { app: 'Notes' } },
      { tool: 'app_tree', args: { app: 'Notes' } },
      { tool: 'app_tree', args: { app: 'Notes' } },
      { tool: 'app_press', args: { app: 'Notes', ref: 'r' } },
      { tool: 'app_set_value', args: { app: 'Notes', ref: 'r', value: 'v' } },
      { tool: 'app_action', args: { app: 'Notes', ref: 'r', action: 'AXPick' } },
      { tool: 'app_screenshot', args: { app: 'Notes' } }
    ]
  },
  {
    name: 'kill-switch-y-canal-caido',
    side: { stopped: () => true },
    steps: [{ tool: 'screenshot' }, { tool: 'left_click', args: { x: 1, y: 1 } }]
  },
  {
    name: 'canal-caido-falla-cerrado',
    side: { down: true },
    steps: [{ tool: 'screenshot' }, { tool: 'left_click', args: { x: 1, y: 1 } }]
  },
  {
    name: 'plan-sin-aprobar',
    side: { planApproved: false },
    steps: [{ tool: 'screenshot' }, { tool: 'left_click', args: { x: 1, y: 1 } }, { tool: 'cursor_position' }]
  },
  {
    name: 'helper-ausente',
    helper: '/no/existe/cu-helper',
    steps: [{ tool: 'cursor_position' }, { tool: 'screenshot' }]
  },
  {
    name: 'app-desconocida',
    steps: [{ tool: 'request_access', args: { apps: ['Zzqx NoExisteApp'], plan: ['x'] } }],
    script: { responses: { 'resolve-app': { out: { name: 'Zzqx NoExisteApp', bundleId: '', found: false } } } }
  }
]

beforeAll(() => {
  if (!macOnly) return
  bundle = bundleMcp(work.dir)
})
afterAll(() => work.cleanup())

// Control del Mac: helper nativo, `sips` y el MCP solo existen en macOS.
describe.skipIf(!macOnly)('MCP de Control del Mac: caracterización (macOS, helper falso)', () => {
  const results: Record<string, unknown> = {}
  const expected: Record<string, unknown> = UPDATE ? {} : (JSON.parse(readFileSync(FIXTURE, 'utf8')) as Record<string, unknown>)

  it.each(SCENARIOS.map((s) => s.name))(
    '%s',
    async (name) => {
      const sc = SCENARIOS.find((s) => s.name === name)!
      const got = await run(sc)
      results[name] = got
      if (!UPDATE) expect(got).toEqual(expected[name])
    },
    60_000
  )

  afterAll(() => {
    if (UPDATE) writeFileSync(FIXTURE, JSON.stringify(results, null, 1) + '\n')
  })

  it('el fixture cubre exactamente los escenarios', () => {
    if (!UPDATE) expect(Object.keys(expected).sort()).toEqual(SCENARIOS.map((s) => s.name).sort())
  })
})
