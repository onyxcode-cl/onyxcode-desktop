/**
 * P4: texto que recibe el AGENTE cuando una app está bloqueada (`request_access` / `request_full_control`). Se prueba el MCP real
 * con el helper falso y un canal lateral que responde `blocked` como lo haría main. Nunca debe ofrecer otra vía, alternativa ni permiso.
 */
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { FAKE_HELPER, bundleMcp, startMcp, startSideChannel, textOf, tmpWork, type McpProc, type SideChannel } from '../../test/cu-mcp-kit'
import { exeKey } from './policy/app-key'

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

const NOT_FOUND = { 'resolve-app': { out: { name: 'x', bundleId: '', found: false } } }
const bl = (bundleId: string, name: string, kind: 'fixed' | 'user' | 'session'): { bundleId: string; name: string; kind: string } => ({
  bundleId,
  name,
  kind
})
const FORBIDDEN = /otra vía|alternativa|puedes/i

describe('texto al agente con apps bloqueadas', () => {
  it('todo bloqueado y sin plan: solo el texto firme, sin vías alternativas', async () => {
    const { mcp, done } = await boot({
      script: script(NOT_FOUND),
      side: {
        requestAccess: () => ({
          decisions: { [NOTEPAD]: 'deny' },
          cancelled: false,
          planApproved: false,
          blocked: [bl(NOTEPAD, 'Bloc de notas', 'user')]
        })
      }
    })
    try {
      const t = textOf(await mcp.call('request_access', { apps: ['Bloc de notas'], levels: ['full'] }))
      expect(t).toContain('Bloc de notas está bloqueada por la persona.')
      expect(t).toContain('No la pidas de nuevo')
      for (const w of ['otra aplicación', 'script', 'navegador', 'comando', 'atajo']) expect(t).toContain(w)
      expect(t).not.toMatch(FORBIDDEN)
    } finally {
      await done()
    }
  })

  it('tipo «session»: dice que es SOLO para esta tarea; «fixed»: por seguridad', async () => {
    for (const [kind, frag] of [
      ['session', 'por la persona SOLO para esta tarea'],
      ['fixed', 'por seguridad']
    ] as const) {
      const { mcp, done } = await boot({
        script: script(NOT_FOUND),
        side: {
          requestAccess: () => ({
            decisions: { [NOTEPAD]: 'deny' },
            cancelled: false,
            planApproved: false,
            blocked: [bl(NOTEPAD, 'Bloc de notas', kind)]
          })
        }
      })
      try {
        const t = textOf(await mcp.call('request_access', { apps: ['Bloc de notas'] }))
        expect(t).toContain(`está bloqueada ${frag}`)
        expect(t).not.toMatch(FORBIDDEN)
      } finally {
        await done()
      }
    }
  })

  it('mezcla: la bloqueada lleva su línea firme y la otra su decisión', async () => {
    const { mcp, done } = await boot({
      script: script(NOT_FOUND),
      side: {
        requestAccess: () => ({
          decisions: { [NOTEPAD]: 'deny', [CHROME]: 'view' },
          cancelled: false,
          planApproved: true,
          blocked: [bl(NOTEPAD, 'Bloc de notas', 'user')]
        })
      }
    })
    try {
      const t = textOf(await mcp.call('request_access', { apps: ['Bloc de notas', 'Chrome'], levels: ['view', 'view'], plan: ['leer'] }))
      expect(t).toContain('- Bloc de notas está bloqueada por la persona.')
      expect(t).toMatch(/- Chrome: Solo ver/)
      // «puedes» aparece en la línea genérica del plan aprobado: solo se revisa la línea de la bloqueada.
      expect(t.split('\n').find((l) => l.includes('Bloc de notas está bloqueada'))).not.toMatch(FORBIDDEN)
    } finally {
      await done()
    }
  })

  it('tarjeta mixta cancelada: el mensaje de cancelación incluye también la línea de la bloqueada', async () => {
    const { mcp, done } = await boot({
      script: script(NOT_FOUND),
      side: {
        requestAccess: () => ({ decisions: {}, cancelled: true, planApproved: false, blocked: [bl(NOTEPAD, 'Bloc de notas', 'fixed')] })
      }
    })
    try {
      const t = textOf(await mcp.call('request_access', { apps: ['Bloc de notas', 'Chrome'], plan: ['x'] }))
      expect(t).toContain('El usuario canceló')
      expect(t).toContain('Bloc de notas está bloqueada por seguridad.')
      expect(t).not.toMatch(FORBIDDEN)
    } finally {
      await done()
    }
  })

  it('takeover (request_full_control): devuelve el texto de blocked[0]', async () => {
    const { mcp, done } = await boot({
      script: script(NOT_FOUND),
      side: {
        controlMode: { mode: 'background', foreground: false },
        requestAccess: () => ({
          decisions: { [NOTEPAD]: 'deny' },
          cancelled: false,
          planApproved: false,
          blocked: [bl(NOTEPAD, 'Bloc de notas', 'session')]
        })
      }
    })
    try {
      const t = textOf(await mcp.call('request_full_control', { app: 'Bloc de notas', reason: 'arrastrar' }))
      expect(t).toContain('Bloc de notas está bloqueada por la persona SOLO para esta tarea.')
      expect(t).not.toMatch(FORBIDDEN)
    } finally {
      await done()
    }
  })
})
