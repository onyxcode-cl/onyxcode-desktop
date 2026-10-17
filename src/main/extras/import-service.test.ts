import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AppMcpConfig, McpEntry } from '@shared/ipc-extras'
import { IPC_SCHEMAS } from '../ipc/schemas'
import { decide } from '../remote/policy'
import { createImportService, IMPORT_TTL_MS, type ImportDeps } from './import-service'
import { sanitizeMcpServer } from './import-sources'

const FAKE_KEY = ['sk', 'ant', 'api03', 'Qq7'.repeat(10)].join('-')

let dir: string
let saved: Record<string, McpEntry>
let agents: { content: string; exists: boolean }
let clock: number

function deps(over: Partial<ImportDeps> = {}): ImportDeps {
  return {
    pickPath: async () => dir,
    validateFolder: (f) => f,
    existingMcpNames: () => new Set(Object.keys(saved)),
    readAgents: () => agents,
    saveAgents: (folder, content) => {
      writeFileSync(join(folder, 'AGENTS.md'), content)
      agents = { content, exists: true }
    },
    saveMcp: (name, entry) => {
      saved[name] = entry
    },
    maskedMcp: () => ({ path: 'x', servers: saved }) as AppMcpConfig,
    afterMcpChange: async () => ({ path: 'x', servers: saved }) as AppMcpConfig,
    now: () => clock,
    ...over
  }
}

beforeEach(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), 'lzx-impsvc-')))
  saved = {}
  agents = { content: '', exists: false }
  clock = 1_000_000
  writeFileSync(join(dir, 'CLAUDE.md'), '# Reglas\nResponde breve.\n')
  writeFileSync(
    join(dir, '.mcp.json'),
    JSON.stringify({
      mcpServers: { buscador: { command: 'npx', args: ['-y', 'pkg'], env: { API_KEY: FAKE_KEY } }, malo: { command: 'sudo', args: ['x'] } }
    })
  )
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('servicio de importación', () => {
  it('la vista previa no escribe nada, no lleva secretos y cancelar devuelve null', async () => {
    const svc = createImportService(deps())
    const p = (await svc.pick({ source: 'project-folder' }))!
    expect(p.items.map((i) => [i.name, i.status])).toEqual([
      ['CLAUDE.md', 'ok'],
      ['buscador', 'ok'],
      ['malo', 'discarded']
    ])
    expect(JSON.stringify(p)).not.toContain(FAKE_KEY)
    expect(saved).toEqual({})
    expect(agents.exists).toBe(false)
    expect(await createImportService(deps({ pickPath: async () => null })).pick({ source: 'mcp-file' })).toBeNull()
  })

  it('importa solo lo marcado; el MCP entra desactivado y con la variable por nombre; AGENTS.md se crea', async () => {
    const svc = createImportService(deps())
    const p = (await svc.pick({ source: 'project-folder' }))!
    const mcpId = p.items.find((i) => i.name === 'buscador')!.id
    const r = await svc.apply({ token: p.token, ids: [mcpId] })
    expect(r.results).toEqual([{ id: mcpId, ok: true }])
    expect(saved.buscador).toMatchObject({ enabled: false, environment: { API_KEY: '{env:API_KEY}' } })
    expect(JSON.stringify(saved)).not.toContain(FAKE_KEY)
    expect(agents.exists).toBe(false) // no se marcó CLAUDE.md

    const p2 = (await svc.pick({ source: 'project-folder' }))!
    const instr = p2.items.find((i) => i.name === 'CLAUDE.md')!.id
    const r2 = await svc.apply({ token: p2.token, ids: [instr] })
    expect(r2.results[0].ok).toBe(true)
    expect(readFileSync(join(dir, 'AGENTS.md'), 'utf8')).toBe('# Reglas\nResponde breve.\n')
  })

  it('no importa lo descartado ni ids desconocidos, y la ficha es de un solo uso', async () => {
    const svc = createImportService(deps())
    const p = (await svc.pick({ source: 'project-folder' }))!
    const malo = p.items.find((i) => i.name === 'malo')!.id
    const r = await svc.apply({ token: p.token, ids: [malo, 'm99'] })
    expect(r.results.every((x) => !x.ok)).toBe(true)
    expect(saved).toEqual({})
    await expect(svc.apply({ token: p.token, ids: [] })).rejects.toThrow()
  })

  it('la ficha caduca, y una ficha ajena se rechaza', async () => {
    const svc = createImportService(deps())
    const p = (await svc.pick({ source: 'project-folder' }))!
    await expect(svc.apply({ token: 'f'.repeat(32), ids: ['m1'] })).rejects.toThrow()
    clock += IMPORT_TTL_MS + 1
    await expect(svc.apply({ token: p.token, ids: ['m1'] })).rejects.toThrow()
  })

  it('si el archivo cambia entre la vista previa y la confirmación, no se escribe', async () => {
    const svc = createImportService(deps())
    const p = (await svc.pick({ source: 'project-folder' }))!
    writeFileSync(join(dir, 'CLAUDE.md'), '# Otro contenido\n')
    const r = await svc.apply({ token: p.token, ids: [p.items.find((i) => i.name === 'CLAUDE.md')!.id] })
    expect(r.results[0].ok).toBe(false)
    expect(agents.exists).toBe(false)
  })

  it('un nombre que apareció mientras tanto no se pisa', async () => {
    const svc = createImportService(deps())
    const p = (await svc.pick({ source: 'project-folder' }))!
    saved.buscador = { type: 'local', command: ['otro'] }
    const r = await svc.apply({ token: p.token, ids: [p.items.find((i) => i.name === 'buscador')!.id] })
    expect(r.results[0].ok).toBe(false)
    expect(saved.buscador).toEqual({ type: 'local', command: ['otro'] })
  })

  it('archivo elegido (mcp-file): lee solo ese archivo y valida el JSON', async () => {
    const f = join(dir, 'otra.json')
    mkdirSync(join(dir, 'sub'))
    writeFileSync(
      f,
      JSON.stringify({ servers: { x: { type: 'http', url: 'https://example.com/mcp', headers: { 'X-Api-Key': FAKE_KEY } } } })
    )
    const svc = createImportService(deps({ pickPath: async () => f }))
    const p = (await svc.pick({ source: 'mcp-file' }))!
    expect(p.label).toBe('otra.json')
    expect(p.items).toHaveLength(1)
    expect(JSON.stringify(p)).not.toContain(FAKE_KEY)
    writeFileSync(f, '{roto')
    await expect(svc.pick({ source: 'mcp-file' })).rejects.toThrow()
  })

  it('el resumen de un comando descartado no lleva el secreto', () => {
    const it = sanitizeMcpServer(
      'm0',
      'x',
      { command: 'curl', args: ['-H', `Authorization: Bearer ${FAKE_KEY}`, 'https://a.example'] },
      'f',
      new Set()
    )
    expect(it.item.status).toBe('discarded')
    expect(JSON.stringify(it)).not.toContain(FAKE_KEY)
  })
})

describe('IPC de importar', () => {
  const pick = IPC_SCHEMAS['extras:import:pick']
  const apply = IPC_SCHEMAS['extras:import:apply']
  it('esquemas estrictos: sin claves extra ni rutas, fuente y ids acotados', () => {
    expect(pick({ source: 'project-folder' }, '')).toEqual({ source: 'project-folder' })
    expect(() => pick({ source: 'project-folder', path: '/etc' }, '')).toThrow()
    expect(() => pick({ source: 'disco' }, '')).toThrow()
    expect(() => pick({}, '')).toThrow()
    const token = 'a'.repeat(32)
    expect(apply({ token, ids: ['i0', 'm12'] }, '')).toEqual({ token, ids: ['i0', 'm12'] })
    expect(() => apply({ token: 'XYZ', ids: [] }, '')).toThrow()
    expect(() => apply({ token, ids: ['../x'] }, '')).toThrow()
    expect(() => apply({ token, ids: [], extra: 1 }, '')).toThrow()
  })

  it('política remota: clase X para ambos canales (el celular no importa)', () => {
    const ctx = {
      allowedDirs: [],
      chatDirs: [],
      fullAccessDirs: [],
      knownModels: new Set<string>(),
      permissionKind: () => undefined,
      isDirectory: () => undefined,
      home: '/Users/me'
    }
    for (const channel of ['extras:import:pick', 'extras:import:apply']) {
      expect(decide({ kind: 'ipc', channel, payload: {} }, ctx)).toMatchObject({ allow: false })
    }
  })
})
