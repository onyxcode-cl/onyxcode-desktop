/**
 * ZONA INTOCABLE (plugin `lazunox-session`, escrito por `prepareOpencodeConfigDir`): ejecuta el TEXTO REAL de `sessionPluginSource()`.
 * El motor 1.19 llama a `tool.execute.before` con `{ tool: <servidor>_<herramienta>, sessionID, callID }` y `{ args }`, y luego llama
 * al MCP con ESE mismo objeto `args`, tanto en la llamada directa como en las internas de Code Mode (`execute` → `tools.<srv>.<herr>`,
 * `callID` = `<execute>/<n>`). Comprobado con el binario real y un proveedor falso: `scripts/engine-probe/run.mjs`.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { sessionPluginSource } from './opencode-config'

type Before = (input: { tool: unknown; sessionID: string; callID?: string }, output: { args: unknown }) => Promise<void>

let dir = ''
let before: Before
beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'lazunox-session-plugin-'))
  const file = join(dir, 'lazunox-session.mjs')
  writeFileSync(file, sessionPluginSource(), 'utf8')
  const mod = (await import(/* @vite-ignore */ pathToFileURL(file).href)) as {
    default: { id: string; server: () => Promise<Record<string, unknown>> }
  }
  expect(mod.default.id).toBe('lazunox-session')
  before = (await mod.default.server())['tool.execute.before'] as Before
})
afterAll(() => rmSync(dir, { recursive: true, force: true }))

const call = async (tool: unknown, args: unknown, callID = 'call_1'): Promise<unknown> => {
  const output = { args }
  await before({ tool, sessionID: 'ses_real', callID }, output)
  return output.args
}

describe('plugin lazunox-session: inyecta la sesión que llama', () => {
  it('browser_*: inyecta y SOBRESCRIBE lo que ponga el modelo (sin cambios de comportamiento)', async () => {
    expect(await call('browser_navigate', { url: 'x', lazunox_session: 'FALSA' })).toEqual({ url: 'x', lazunox_session: 'ses_real' })
  })

  it('bgshell_* (F8-B205): todas sus herramientas reciben la sesión y el modelo no puede fijarla', async () => {
    for (const t of ['bgshell_start', 'bgshell_status', 'bgshell_read', 'bgshell_stop', 'bgshell_list']) {
      expect(await call(t, { command: 'sleep 1', lazunox_session: 'ses_de_otro' })).toMatchObject({ lazunox_session: 'ses_real' })
    }
  })

  it('Code Mode: la llamada interna (callID <execute>/<n>) también se inyecta', async () => {
    expect(await call('bgshell_start', { command: 'ls', lazunox_session: 'FALSA' }, 'call_9/2')).toMatchObject({
      lazunox_session: 'ses_real'
    })
    expect(await call('browser_click', {}, 'call_9/3')).toMatchObject({ lazunox_session: 'ses_real' })
  })

  it('no toca otras herramientas (computer_* lo hace el plan-gate) ni prefijos parecidos', async () => {
    for (const t of ['computer_click', 'bash', 'gmail_send', 'bgshellx_start', 'xbgshell_start', 'shell_bg_start', 'execute']) {
      expect(await call(t, { lazunox_session: 'x' })).toEqual({ lazunox_session: 'x' })
    }
  })

  it('args ausentes o no objeto, o tool no textual: no falla ni inventa nada', async () => {
    expect(await call('bgshell_start', undefined)).toBeUndefined()
    expect(await call('bgshell_start', null)).toBeNull()
    expect(await call('bgshell_start', 'texto')).toBe('texto')
    expect(await call(42, { a: 1 })).toEqual({ a: 1 })
  })
})

describe('plugin lazunox-session con el puente de apps (modo unificado)', () => {
  const load = async (unified: boolean, bridgeEnv: string | undefined): Promise<Before> => {
    const file = join(dir, `lazunox-session-${unified}-${bridgeEnv}.mjs`)
    writeFileSync(file, sessionPluginSource(unified), 'utf8')
    const prev = process.env.LAZUNOX_UNIFIED_BRIDGE
    if (bridgeEnv === undefined) delete process.env.LAZUNOX_UNIFIED_BRIDGE
    else process.env.LAZUNOX_UNIFIED_BRIDGE = bridgeEnv
    try {
      const mod = (await import(/* @vite-ignore */ pathToFileURL(file).href)) as {
        default: { server: () => Promise<Record<string, unknown>> }
      }
      return (await mod.default.server())['tool.execute.before'] as Before
    } finally {
      if (prev === undefined) delete process.env.LAZUNOX_UNIFIED_BRIDGE
      else process.env.LAZUNOX_UNIFIED_BRIDGE = prev
    }
  }
  const run = async (b: Before, tool: string): Promise<unknown> => {
    const output = { args: { lazunox_session: 'FALSA' } }
    await b({ tool, sessionID: 'ses_real' }, output)
    return output.args
  }

  it('sin bandera el texto es idéntico al de siempre (computer_* no se toca)', () => {
    expect(sessionPluginSource(false)).toBe(sessionPluginSource())
    expect(sessionPluginSource(false)).not.toContain('computer_')
  })

  it('con bandera y servidor con puente: computer_* recibe la sesión (sin puerta del plan) y se pisa lo del modelo', async () => {
    const b = await load(true, '1')
    expect(await run(b, 'computer_request_access')).toEqual({ lazunox_session: 'ses_real' })
    expect(await run(b, 'browser_click')).toEqual({ lazunox_session: 'ses_real' })
    expect(await run(b, 'bash')).toEqual({ lazunox_session: 'FALSA' })
  })

  it('con bandera pero en un servidor sin puente (p. ej. Control total): computer_* no se toca aquí', async () => {
    const b = await load(true, undefined)
    expect(await run(b, 'computer_request_access')).toEqual({ lazunox_session: 'FALSA' })
    expect(await run(b, 'browser_click')).toEqual({ lazunox_session: 'ses_real' })
  })
})
