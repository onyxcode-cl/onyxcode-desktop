import { mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { CompareManifest } from '@shared/ipc-code'
import { posixOnly } from '../../test/platform'
import { emptyMetrics } from './metrics'
import { ManifestStore, parseManifest } from './manifest'

const ID = '0a1b2c3d-1111-4222-8333-444455556666'
let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'lazunox-cmpman-'))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const sample = (over: Partial<CompareManifest> = {}): CompareManifest => ({
  v: 1,
  id: ID,
  mode: 'code',
  cwd: '/work/proj',
  baseCommit: 'a'.repeat(40),
  dirtyAtStart: false,
  createdAt: 1,
  promptPreview: 'hola',
  permissionMode: 'auto',
  pausedProviders: [],
  columns: [0, 1].map((index) => ({
    index,
    model: { providerID: 'p', modelID: 'm' + index },
    sessionID: null,
    worktree: { path: `/work/.proj-worktrees/lazunox-compare-0a1b2c3d-${index}`, branch: `lazunox-compare/0a1b2c3d-${index}` },
    state: 'queued',
    adopted: false,
    discarded: false,
    startedAt: null,
    finishedAt: null,
    metrics: emptyMetrics(),
    error: null,
    retryAt: null,
    retried: false,
    stopUnconfirmed: false,
    interrupted: false,
    diff: null
  })),
  ...over
})

describe('manifiesto de comparaciones', () => {
  it('escribe de forma atómica (sin .tmp sobrantes) y se lee igual', () => {
    const s = new ManifestStore(dir, () => undefined)
    s.write(sample())
    s.write(sample({ promptPreview: 'otro' }))
    expect(readdirSync(dir)).toEqual([`${ID}.json`])
    expect(s.read(ID)?.promptPreview).toBe('otro')
    expect(s.list()).toHaveLength(1)
    s.remove(ID)
    expect(s.list()).toEqual([])
  })

  it.skipIf(!posixOnly)('el archivo queda con permisos 0600 (permisos POSIX)', () => {
    const s = new ManifestStore(dir, () => undefined)
    s.write(sample())
    expect(statSync(join(dir, `${ID}.json`)).mode & 0o777).toBe(0o600)
  })

  it('un archivo corrupto o con forma inválida se ignora y se registra', () => {
    const logs: string[] = []
    const s = new ManifestStore(dir, (m) => logs.push(m))
    writeFileSync(join(dir, `${ID}.json`), '{no es json')
    writeFileSync(join(dir, '1b2c3d4e-1111-4222-8333-444455556666.json'), JSON.stringify({ v: 1, id: 'x' }))
    s.write(sample({ id: '2b2c3d4e-1111-4222-8333-444455556666' }))
    expect(s.list().map((m) => m.id)).toEqual(['2b2c3d4e-1111-4222-8333-444455556666'])
    expect(logs.length).toBeGreaterThanOrEqual(2)
  })

  it('rechaza ids que no son uuid (nada de rutas)', () => {
    const s = new ManifestStore(dir)
    expect(() => s.read('../../etc/passwd')).toThrow()
    expect(() => s.remove('x/../y')).toThrow()
  })

  it('parseManifest rechaza ramas fuera de lazunox-compare/, rutas relativas y columnas repetidas', () => {
    const bad = sample()
    bad.columns[0].worktree = { path: '/w/x', branch: 'main' }
    expect(parseManifest(JSON.parse(JSON.stringify(bad)))).toBeNull()
    const rel = sample()
    rel.columns[0].worktree = { path: 'relativa', branch: 'lazunox-compare/0a1b2c3d-0' }
    expect(parseManifest(JSON.parse(JSON.stringify(rel)))).toBeNull()
    const dup = sample()
    dup.columns[1].index = 0
    expect(parseManifest(JSON.parse(JSON.stringify(dup)))).toBeNull()
    expect(parseManifest(JSON.parse(JSON.stringify(sample())))).not.toBeNull()
  })
})
