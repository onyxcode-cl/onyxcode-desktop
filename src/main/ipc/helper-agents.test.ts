import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HelperDef } from '@shared/helper-agents'
import { posixOnly } from '../../test/platform'

vi.mock('electron', () => ({ dialog: {}, app: {}, ipcMain: {} }))
vi.mock('../store', () => ({ settingsStore: { get: () => ({ recentFolders: [] }) } }))

import {
  claudeAgentNames,
  forgetPickedFoldersForTests,
  inspectForeignAgents,
  listHelpers,
  readHelper,
  rememberPickedFolder,
  resolveHelperFolder,
  saveHelper,
  type HelperDeps
} from './helper-agents'

const DEF: HelperDef = {
  name: 'lector',
  description: 'Lee cosas',
  prompt: 'Lee y resume.',
  model: 'small',
  disallowedTools: ['edit'],
  maxTurns: 4,
  background: false,
  skills: null
}

let root: string
let outside: string
let recent: string[]
const deps = (over: Partial<HelperDeps> = {}): HelperDeps => ({
  conn: () => ({ baseUrl: 'http://127.0.0.1:1', authorization: 'Basic x' }),
  recentFolders: () => recent,
  ...over
})
const file = (name: string): string => join(root, '.opencode', 'agents', `${name}.md`)

beforeEach(() => {
  forgetPickedFoldersForTests()
  root = mkdtempSync(join(tmpdir(), 'lzx-helpers-'))
  outside = mkdtempSync(join(tmpdir(), 'lzx-helpers-out-'))
  recent = [root]
})
afterEach(() => {
  rmSync(root, { recursive: true, force: true })
  rmSync(outside, { recursive: true, force: true })
})

describe('carpeta permitida', () => {
  it('solo las elegidas con el diálogo o las recientes; el resto, no', async () => {
    expect(await resolveHelperFolder(root, [])).toBeNull()
    expect(await resolveHelperFolder(root, [root])).not.toBeNull()
    expect(await rememberPickedFolder(outside)).not.toBeNull()
    expect(await resolveHelperFolder(outside, [])).not.toBeNull()
    expect(await resolveHelperFolder('relativa/x', [root])).toBeNull()
    expect(await resolveHelperFolder(join(root, 'no-existe'), [root])).toBeNull()
  })
})

describe('guardar', () => {
  it('crea .opencode/agents/<nombre>.md y no pisa uno existente', async () => {
    expect(await saveHelper(deps(), { directory: root, def: DEF, mode: 'create' })).toEqual({ ok: true })
    const text = readFileSync(file('lector'), 'utf8')
    expect(text).toContain('mode: subagent')
    expect(text).toContain('max_turns: 4')
    expect(await saveHelper(deps(), { directory: root, def: DEF, mode: 'create' })).toEqual({ ok: false, reason: 'exists' })
  })

  it('editar conserva lo que la pantalla no gestiona', async () => {
    mkdirSync(join(root, '.opencode', 'agents'), { recursive: true })
    writeFileSync(file('lector'), '---\ndescription: viejo\ncolor: "#fff"\npermission:\n  bash: ask\n---\nCuerpo\n')
    expect(await saveHelper(deps(), { directory: root, def: { ...DEF, description: 'nuevo' }, mode: 'edit' })).toEqual({ ok: true })
    const text = readFileSync(file('lector'), 'utf8')
    expect(text).toContain('color: "#fff"')
    expect(text).toContain('permission:\n  bash: ask')
    expect(text).toContain('description: "nuevo"')
    expect(readdirSync(join(root, '.opencode', 'agents'))).toEqual(['lector.md']) // sin temporales
  })

  it('editar un archivo inexistente -> missing; con formato que no sabe editar -> complex y no lo toca', async () => {
    expect(await saveHelper(deps(), { directory: root, def: DEF, mode: 'edit' })).toMatchObject({ ok: false, reason: 'missing' })
    mkdirSync(join(root, '.opencode', 'agents'), { recursive: true })
    const original = '---\ndescription: >\n  largo\n---\nx\n'
    writeFileSync(file('lector'), original)
    expect(await saveHelper(deps(), { directory: root, def: DEF, mode: 'edit' })).toEqual({ ok: false, reason: 'complex' })
    expect(readFileSync(file('lector'), 'utf8')).toBe(original)
  })

  it('nombres inválidos y reservados no escriben nada', async () => {
    for (const name of ['../fuera', 'a/b', '.oculto', 'a.md', '']) {
      expect(await saveHelper(deps(), { directory: root, def: { ...DEF, name }, mode: 'create' }), name).toEqual({
        ok: false,
        reason: 'name'
      })
    }
    for (const name of ['build', 'Plan', 'revisor', 'verificador', 'lazunox-helper']) {
      expect(await saveHelper(deps(), { directory: root, def: { ...DEF, name }, mode: 'create' }), name).toEqual({
        ok: false,
        reason: 'reserved'
      })
    }
    expect(existsSync(join(root, '.opencode'))).toBe(false)
  })

  it('campos inválidos se rechazan con el nombre del campo', async () => {
    expect(await saveHelper(deps(), { directory: root, def: { ...DEF, maxTurns: 0 }, mode: 'create' })).toEqual({
      ok: false,
      reason: 'invalid',
      field: 'maxTurns'
    })
    expect(await saveHelper(deps(), { directory: root, def: { ...DEF, disallowedTools: ['a\nb'] }, mode: 'create' })).toMatchObject({
      reason: 'invalid',
      field: 'disallowedTools'
    })
  })

  it('una carpeta que no eligió la persona no se toca', async () => {
    expect(await saveHelper(deps(), { directory: outside, def: DEF, mode: 'create' })).toEqual({ ok: false, reason: 'folder' })
    expect(existsSync(join(outside, '.opencode'))).toBe(false)
  })

  it.skipIf(!posixOnly)('NO sigue enlaces: .opencode, agents o el archivo como symlink se rechazan y no escriben fuera', async () => {
    // .opencode -> carpeta ajena
    symlinkSync(outside, join(root, '.opencode'))
    expect(await saveHelper(deps(), { directory: root, def: DEF, mode: 'create' })).toEqual({ ok: false, reason: 'link' })
    expect(readdirSync(outside)).toEqual([])
    rmSync(join(root, '.opencode'))
    // agents -> carpeta ajena
    mkdirSync(join(root, '.opencode'))
    symlinkSync(outside, join(root, '.opencode', 'agents'))
    expect(await saveHelper(deps(), { directory: root, def: DEF, mode: 'create' })).toEqual({ ok: false, reason: 'link' })
    expect(readdirSync(outside)).toEqual([])
    rmSync(join(root, '.opencode', 'agents'))
    // el archivo -> archivo ajeno
    mkdirSync(join(root, '.opencode', 'agents'))
    const target = join(outside, 'secreto.md')
    writeFileSync(target, 'intacto')
    symlinkSync(target, file('lector'))
    expect(await saveHelper(deps(), { directory: root, def: DEF, mode: 'create' })).toEqual({ ok: false, reason: 'link' })
    expect(await saveHelper(deps(), { directory: root, def: DEF, mode: 'edit' })).toEqual({ ok: false, reason: 'link' })
    expect(readFileSync(target, 'utf8')).toBe('intacto')
    expect(await readHelper(deps(), { directory: root, name: 'lector' })).toMatchObject({ ok: false, reason: 'missing' })
  })

  it.skipIf(!posixOnly)('la carpeta elegida que es un enlace se resuelve a su destino real', async () => {
    const link = join(outside, 'enlace')
    symlinkSync(root, link)
    expect(await resolveHelperFolder(link, [root])).toBe(await resolveHelperFolder(root, [root]))
  })
})

describe('leer', () => {
  it('devuelve la definición; nombre inválido o carpeta ajena fallan', async () => {
    await saveHelper(deps(), { directory: root, def: DEF, mode: 'create' })
    expect(await readHelper(deps(), { directory: root, name: 'lector' })).toMatchObject({ ok: true, def: { name: 'lector', maxTurns: 4 } })
    expect(await readHelper(deps(), { directory: root, name: '../x' })).toEqual({ ok: false, reason: 'name' })
    expect(await readHelper(deps(), { directory: outside, name: 'lector' })).toEqual({ ok: false, reason: 'folder' })
    expect(await readHelper(deps(), { directory: root, name: 'nada' })).toMatchObject({ ok: false, reason: 'missing' })
  })
  it('un archivo gigante no se lee', async () => {
    mkdirSync(join(root, '.opencode', 'agents'), { recursive: true })
    writeFileSync(file('grande'), `---\nmodel: small\n---\n${'x'.repeat(70_000)}`)
    expect(await readHelper(deps(), { directory: root, name: 'grande' })).toEqual({ ok: false, reason: 'too_big' })
  })
})

describe('.claude/agents', () => {
  it('cuenta los .md (con subcarpetas), sin entrar en enlaces ni contar otros archivos', async () => {
    const d = join(root, '.claude', 'agents')
    mkdirSync(join(d, 'sub'), { recursive: true })
    writeFileSync(join(d, 'a.md'), '---\n---\n')
    writeFileSync(join(d, 'sub', 'b.md'), '---\n---\n')
    writeFileSync(join(d, 'notas.txt'), 'x')
    if (posixOnly) symlinkSync(outside, join(d, 'enlace'))
    writeFileSync(join(outside, 'c.md'), 'x')
    expect((await claudeAgentNames(root)).sort()).toEqual(['a', 'b'])
    expect((await inspectForeignAgents(root)).names.sort()).toEqual(['a', 'b'])
    expect(await inspectForeignAgents('relativa')).toEqual({ names: [] })
    expect(await inspectForeignAgents(join(root, 'no'))).toEqual({ names: [] })
  })
})

describe('listar', () => {
  const agents = [
    { name: 'build', mode: 'primary', native: true, permission: [] },
    { name: 'explore', mode: 'subagent', native: true, permission: [] },
    { name: 'lector', mode: 'subagent', description: 'mío', permission: [] },
    { name: 'de-claude', mode: 'subagent', permission: [] },
    { name: 'global', mode: 'subagent', permission: [] }
  ]
  const ok = (body: unknown): typeof fetch => (async () => new Response(JSON.stringify(body), { status: 200 })) as unknown as typeof fetch

  it('clasifica el origen y marca editables solo los de .opencode/agents', async () => {
    await saveHelper(deps(), { directory: root, def: DEF, mode: 'create' })
    mkdirSync(join(root, '.claude', 'agents'), { recursive: true })
    writeFileSync(join(root, '.claude', 'agents', 'de-claude.md'), '---\n---\n')
    const r = await listHelpers(deps({ fetchImpl: ok(agents) }), { directory: root })
    if (!r.available) throw new Error('debía estar disponible')
    const by = Object.fromEntries(r.helpers.map((h) => [h.name, h]))
    expect(Object.keys(by).sort()).toEqual(['de-claude', 'explore', 'global', 'lector'])
    expect(by.explore).toMatchObject({ origin: 'native', editable: false })
    expect(by.lector).toMatchObject({ origin: 'opencode', editable: true })
    expect(by['de-claude']).toMatchObject({ origin: 'claude', editable: false })
    expect(by.global).toMatchObject({ origin: 'other', editable: false })
    expect(r.claudeNames).toEqual(['de-claude'])
  })

  it('pide /agent con la carpeta y la autorización; 404 = no disponible; carpeta ajena = prohibido', async () => {
    const f = vi.fn(async () => new Response('', { status: 404 }))
    expect(await listHelpers(deps({ fetchImpl: f as never }), { directory: root })).toEqual({ available: false })
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe(`http://127.0.0.1:1/agent?directory=${encodeURIComponent((await resolveHelperFolder(root, [root]))!)}`)
    expect((init.headers as Record<string, string>).Authorization).toBe('Basic x')
    await expect(listHelpers(deps({ fetchImpl: f as never }), { directory: outside })).rejects.toThrow()
    await expect(listHelpers(deps({ conn: () => null }), { directory: root })).rejects.toThrow()
  })

  it('error del motor -> lanza', async () => {
    const f = (async () => new Response('', { status: 500 })) as unknown as typeof fetch
    await expect(listHelpers(deps({ fetchImpl: f }), { directory: root })).rejects.toThrow('500')
  })
})
