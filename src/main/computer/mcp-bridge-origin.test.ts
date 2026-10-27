/**
 * Modo unificado (puente de apps): lo que hace el MCP real (helper falso, canal lateral simulado) según el veredicto de main sobre el origen.
 * Sin cabecera, o con una que main no reconoce, TODO es como siempre (plan obligatorio). Con origen aislado no hay plan, pero cada acción
 * exige sesión válida de ese servidor y la concesión por app del nivel necesario (también `open_application`).
 */
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { FAKE_HELPER, bundleMcp, startMcp, startSideChannel, textOf, tmpWork, type McpProc, type SideChannel } from '../../test/cu-mcp-kit'
import { BRIDGE_ORIGIN_HEADER, BRIDGE_SERVER_HEADER } from '../../shared/unified-bridge'

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
  side: Parameters<typeof startSideChannel>[0]
): Promise<{ mcp: McpProc; side: SideChannel; done: () => Promise<void>; opened: () => number }> {
  const s = await startSideChannel(side)
  const mcp = await startMcp({
    bundle,
    helper: FAKE_HELPER,
    dir: join(work.dir, `w${++seq}`),
    events: s,
    env: { COMPUTER_AUTO_SCREENSHOT: '0', COMPUTER_INSTANT: '1' }
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

describe('sin origen aislado: comportamiento de siempre', () => {
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

describe('origen aislado válido', () => {
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
    const { mcp, side, done } = await boot({ planApproved: false, bridgeCheck: () => ISOLATED_OK, tier: () => 'view' })
    try {
      await mcp.call('screenshot', { elements: false, lazunox_session: SES }, HDRS).catch(() => undefined)
      const r = await mcp.call('left_click', { x: 10, y: 10, lazunox_session: SES }, HDRS)
      expect(r.isError).toBe(true)
      expect(textOf(r)).toContain('solo tiene el nivel')
      expect(mcp.calls().some((c) => c.cmd === 'click')).toBe(false)
      await vi.waitFor(() => expect(side.requests.some((x) => x.path === '/bridge-denied')).toBe(true))
      expect((side.requests.find((x) => x.path === '/bridge-denied')?.body as { reason: string }).reason).toBe('low-tier')
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
