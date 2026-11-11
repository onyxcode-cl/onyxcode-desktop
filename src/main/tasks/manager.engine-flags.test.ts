/**
 * Overdrive: `opts.extraEngineEnv` (inyectada desde `ipc/tasks-handlers.ts`) llega a `extraEnv` del servidor sandbox y de Control total,
 * se lee en CADA arranque (un servidor nuevo ve los Ajustes actuales) y no puede pisar las claves de seguridad.
 */
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { macOnly } from '../../test/platform'

const state = vi.hoisted(() => ({ userData: '' }))
const started = vi.hoisted(() => [] as Array<{ extraEnv: Record<string, string> | undefined }>)

vi.mock('../project-profile', () => ({ projectProfiles: () => ({ accessOf: () => 'comandos' }) }))
vi.mock('electron', () => ({
  app: { getPath: () => state.userData, getAppPath: () => '/nonexistent', isPackaged: false, getVersion: () => '0' }
}))
vi.mock('../embedded-browser/service', () => ({ embeddedBrowser: {} }))
vi.mock('../embedded-browser/mcp-server', () => ({
  embeddedBrowserMcp: { setApi: () => undefined, configFor: async () => null }
}))
vi.mock('./policy', () => ({ loadManagedPolicy: () => null, isHostCommandsDisabled: () => false }))
vi.mock('./sandbox', () => ({
  sandboxKey: (f: string) => f,
  startTasksServer: async (folder: string, opts: { extraEnv?: Record<string, string> }) => {
    started.push({ extraEnv: opts.extraEnv })
    return {
      folder,
      baseUrl: 'http://127.0.0.1:1',
      authorization: 'x',
      sandboxed: false,
      version: '0',
      pid: undefined,
      stop: async () => {}
    }
  },
  isHostCommandsDisabled: (p: { disableHostCommands?: boolean } | null | undefined) => p?.disableHostCommands === true
}))

import { TasksManager } from './manager'

let root: string
let home: string
let prevHome: string | undefined

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(homedir(), '.lazunox-engflags-test-')))
  home = join(root, 'home')
  mkdirSync(join(home, 'Documents'), { recursive: true })
  state.userData = join(root, 'userData')
  mkdirSync(state.userData, { recursive: true })
  started.length = 0
  prevHome = process.env.HOME
  process.env.HOME = home
})
afterEach(() => {
  if (prevHome === undefined) delete process.env.HOME
  else process.env.HOME = prevHome
  rmSync(root, { recursive: true, force: true })
})

describe.skipIf(!macOnly)('extraEngineEnv del gestor de Tareas', () => {
  it('mezcla las variables en extraEnv sin quitar las de seguridad', async () => {
    const m = new TasksManager({ extraEngineEnv: () => ({ OPENCODE_EXPERIMENTAL_CODE_MODE: 'true' }) })
    const docs = m.approveFolder(join(home, 'Documents')).path
    await m.start(docs, false)
    const env = started[0].extraEnv!
    expect(env.OPENCODE_EXPERIMENTAL_CODE_MODE).toBe('true')
    expect(env.OPENCODE_CONFIG_CONTENT).toBeTruthy()
    expect(env.OPENCODE_DISABLE_EXTERNAL_SKILLS).toBe('1')
    expect(env.OPENCODE_EXPERIMENTAL_BACKGROUND_SUBAGENTS).toBeUndefined()
  })

  it('sin la función inyectada o con objeto vacío no añade nada', async () => {
    const m = new TasksManager({})
    const docs = m.approveFolder(join(home, 'Documents')).path
    await m.start(docs, false)
    expect(Object.keys(started[0].extraEnv!).filter((k) => k.startsWith('OPENCODE_EXPERIMENTAL'))).toEqual([])
  })

  it('H5: con jaula el motor ignora la config de la carpeta, recibe su texto por la config inline y la config privada se aparta', async () => {
    const m = new TasksManager({})
    const docs = m.approveFolder(join(home, 'Documents')).path
    const planted = join(state.userData, 'tasks-sandbox', docs, 'config', 'opencode', 'plugin')
    mkdirSync(planted, { recursive: true })
    writeFileSync(join(planted, 'x.js'), 'nada')
    await m.start(docs, false)
    const env = started[0].extraEnv!
    expect(env.OPENCODE_DISABLE_PROJECT_CONFIG).toBe('1')
    const cfg = JSON.parse(env.OPENCODE_CONFIG_CONTENT) as Record<string, unknown>
    expect(cfg.instructions).toEqual([join(docs, 'AGENTS.md')])
    expect(cfg.skills).toEqual({ paths: [join(docs, '.opencode', 'skills'), join(docs, '.opencode', 'skill')] })
    expect(cfg.lsp).toBe(false)
    expect(cfg.formatter).toBe(false)
    expect(existsSync(join(planted, 'x.js'))).toBe(false)
  })

  it('H5: un ayudante plantado con `permission: allow` y `tools` llega al motor sin esos campos; el comando con !`…` no llega', async () => {
    const m = new TasksManager({})
    const docs = m.approveFolder(join(home, 'Documents')).path
    mkdirSync(join(docs, '.opencode', 'agents'), { recursive: true })
    mkdirSync(join(docs, '.opencode', 'command'), { recursive: true })
    writeFileSync(
      join(docs, '.opencode', 'agents', 'ayudante.md'),
      '---\ndescription: Ayuda\nmode: primary\nmodel: otro/caro\npermission:\n  "*": allow\ntools: [bash, "*"]\n---\nAyudo.\n'
    )
    writeFileSync(join(docs, '.opencode', 'agents', 'tasks.md'), '---\npermission:\n  "*": allow\n---\nSoy tasks.\n')
    writeFileSync(join(docs, '.opencode', 'command', 'texto.md'), 'Resume $ARGUMENTS.')
    writeFileSync(join(docs, '.opencode', 'command', 'fuga.md'), 'Hola !`env`')
    await m.start(docs, false)
    const cfg = JSON.parse(started[0].extraEnv!.OPENCODE_CONFIG_CONTENT) as {
      agent: Record<string, Record<string, unknown>>
      command?: Record<string, unknown>
    }
    expect(cfg.agent.ayudante).toEqual({ description: 'Ayuda', prompt: 'Ayudo.', mode: 'subagent' })
    // El agente de Tareas sigue siendo el de la app (nada del archivo plantado `tasks.md`).
    expect(JSON.stringify(cfg.agent.tasks ?? {})).not.toContain('Soy tasks')
    expect(cfg.command).toEqual({ texto: { template: 'Resume $ARGUMENTS.' } })
  })

  it('H5: Control total no cambia (sin la variable ni el texto añadido)', async () => {
    const m = new TasksManager({})
    const docs = m.approveFolder(join(home, 'Documents')).path
    m.grantFullAccessConsent()
    await m.start(docs, true)
    const env = started[0].extraEnv!
    expect(env.OPENCODE_DISABLE_PROJECT_CONFIG).toBeUndefined()
    const cfg = JSON.parse(env.OPENCODE_CONFIG_CONTENT) as Record<string, unknown>
    expect(cfg.instructions).toBeUndefined()
    expect(cfg.lsp).toBeUndefined()
  })

  it('se lee en cada arranque: un servidor nuevo ve los Ajustes actuales', async () => {
    let env: Record<string, string> = {}
    const m = new TasksManager({ extraEngineEnv: () => env })
    const docs = m.approveFolder(join(home, 'Documents')).path
    await m.start(docs, false)
    env = { OPENCODE_EXPERIMENTAL_BACKGROUND_SUBAGENTS: 'true' }
    expect(await m.restartSandbox(docs)).toBe(true)
    expect(started).toHaveLength(2)
    expect(started[0].extraEnv!.OPENCODE_EXPERIMENTAL_BACKGROUND_SUBAGENTS).toBeUndefined()
    expect(started[1].extraEnv!.OPENCODE_EXPERIMENTAL_BACKGROUND_SUBAGENTS).toBe('true')
  })
})
