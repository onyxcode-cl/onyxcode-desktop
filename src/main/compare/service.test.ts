/**
 * Servicio de comparaciones con git REAL en carpetas temporales y un motor falso (sin Electron, sin modelos).
 */
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { CompareManifest } from '@shared/ipc-code'
import { posixOnly } from '../../test/platform'
import { FakeEngine, type FakeScript } from './fake-engine.testkit'
import { createCompareWorktree, removeCompareWorktree, worktreePathFor, branchFor, samePath } from './git'
import { ManifestStore } from './manifest'
import { CompareService } from './service'
import type { CompareLimits } from './limits'

let parent: string
let repo: string
let userData: string
let chatDir: string
const live: CompareService[] = []

const g = (cwd: string, ...args: string[]): string => execFileSync('git', args, { cwd, encoding: 'utf8' })

beforeEach(() => {
  // `.native`: en Windows el tmp puede venir con nombres 8.3 (RUNNER~1); git devuelve la ruta nativa del repo.
  parent = realpathSync.native(mkdtempSync(join(tmpdir(), 'lazunox-cmp-')))
  repo = join(parent, 'proj')
  userData = join(parent, 'userData')
  chatDir = join(parent, 'chat')
  mkdirSync(repo)
  mkdirSync(chatDir)
  g(repo, 'init', '-q')
  g(repo, 'config', 'user.email', 't@t.t')
  g(repo, 'config', 'user.name', 't')
  g(repo, 'config', 'commit.gpgsign', 'false')
  g(repo, 'config', 'core.autocrlf', 'false')
  writeFileSync(join(repo, 'f.txt'), 'one\n')
  writeFileSync(join(repo, 'keep.txt'), 'keep\n')
  g(repo, 'add', '-A')
  g(repo, 'commit', '-q', '-m', 'init')
})

afterEach(async () => {
  const svcs = live.splice(0)
  for (const s of svcs) s.dispose()
  // Al terminar una columna se lanza en segundo plano `git` (resumen del diff) con cwd dentro de la copia: en Windows
  // una carpeta que es el cwd de un proceso vivo no se puede borrar (EBUSY). Se espera a que acabe antes de borrar.
  await Promise.all(svcs.map((s) => s.whenIdle()))
  // En Windows git/antivirus pueden retener la carpeta unos ms (EBUSY/EPERM): se reintenta.
  rmSync(parent, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
})

const FAST: Partial<CompareLimits> = {
  staggerMs: 30,
  pollMs: 15,
  retryBaseMs: 80,
  retryJitterMs: 10,
  abortIdleWaitMs: 150,
  abortPollMs: 20,
  persistMetricsMs: 50
}

function mk(scripts: Record<string, FakeScript>, limits: Partial<CompareLimits> = {}) {
  const events: CompareManifest[] = []
  const engine = new FakeEngine(scripts)
  const store = new ManifestStore(userData, () => undefined)
  const svc = new CompareService({
    store,
    engine: async () => engine,
    chatDirectory: chatDir,
    onChange: (m) => events.push(m),
    limits: { ...FAST, ...limits },
    random: () => 0.5,
    log: () => undefined,
    cliVersion: () => '1.18.32'
  })
  live.push(svc)
  return { svc, engine, events, store }
}

async function waitFor(cond: () => boolean | Promise<boolean>, ms = 5000): Promise<void> {
  const end = Date.now() + ms
  while (Date.now() < end) {
    if (await cond()) return
    await new Promise((r) => setTimeout(r, 10))
  }
  throw new Error('waitFor: tiempo agotado')
}

const states = async (svc: CompareService, id: string): Promise<string[]> =>
  (await svc.list()).find((m) => m.id === id)!.columns.map((c) => c.state)
const allTerminal = async (svc: CompareService, id: string): Promise<boolean> =>
  (await svc.list())
    .find((m) => m.id === id)!
    .columns.every((c) => ['done', 'error', 'cancelled'].includes(c.state) || (c.state === 'rateLimited' && c.retryAt === null))
const branches = (): string => g(repo, 'branch', '--list', 'lazunox-compare/*').trim()
const worktreeCount = (): number =>
  g(repo, 'worktree', 'list', '--porcelain')
    .split('\n')
    .filter((l) => l.startsWith('worktree ')).length
const models = (...ids: string[]) => ids.map((m) => ({ providerID: 'fake', modelID: m }))

describe('crear una comparación en Code', () => {
  it('crea una copia por modelo desde HEAD, escalona los arranques y mide cada columna', async () => {
    const { svc, engine, events } = mk(
      {
        a: { write: { 'a.txt': 'A\n' }, cost: 0.01, tokens: { input: 100, output: 20 } },
        b: { write: { 'b.txt': 'B\n', 'f.txt': 'two\n' }, delayMs: 60 },
        c: { write: { 'c.txt': 'C\n' } }
      },
      { staggerMs: 80 }
    )
    const id = randomUUID()
    const head = g(repo, 'rev-parse', 'HEAD').trim()
    const m = await svc.start({ id, mode: 'code', cwd: repo, models: models('a', 'b', 'c'), prompt: 'haz algo' })
    expect(m.baseCommit).toBe(head)
    expect(m.columns.map((c) => c.worktree!.branch)).toEqual(
      [0, 1, 2].map((n) => `lazunox-compare/${id.replace(/-/g, '').slice(0, 8)}-${n}`)
    )
    expect(worktreeCount()).toBe(4)
    for (const c of m.columns) {
      expect(existsSync(join(c.worktree!.path, 'keep.txt'))).toBe(true)
      expect(c.worktree!.path.startsWith(join(parent, '.proj-worktrees'))).toBe(true)
    }
    await waitFor(() => allTerminal(svc, id))
    const done = (await svc.list())[0]
    expect(done.columns.map((c) => c.state)).toEqual(['done', 'done', 'done'])
    expect(done.columns[0].metrics.costUsd).toBeCloseTo(0.01)
    expect(done.columns[0].metrics.inputTokens).toBe(100)
    expect(done.columns[1].metrics.costUsd).toBeNull()
    expect(done.columns[1].metrics.durationMs).not.toBeNull()
    await waitFor(async () => (await svc.list())[0].columns.every((c) => c.diff !== null))
    expect((await svc.list())[0].columns[1].diff).toEqual({ files: 2, additions: 2, deletions: 1 })
    // Escalonado: arranques separados al menos `staggerMs` (con un margen de reloj).
    const t = engine.startTimes
    expect(t).toHaveLength(3)
    // El escalonado se mide desde la decisión del planificador, no desde la llamada real al motor: con la máquina cargada la
    // llamada puede retrasarse (se vieron 50 ms con `staggerMs: 80`). Se exige al menos la mitad para no depender del reloj.
    // Se compara el tramo completo (dos escalones de 80 ms): en Windows el reloj es de ~15 ms y la primera llamada tarda más
    // (git), de modo que un solo escalón puede medir menos de la mitad. El escalonado exacto lo cubre scheduler.test.ts.
    expect(t[2] - t[0]).toBeGreaterThanOrEqual(80)
    expect(t[1]).toBeGreaterThanOrEqual(t[0])
    expect(t[2]).toBeGreaterThanOrEqual(t[1])
    expect(events.length).toBeGreaterThan(3)
    // Cada sesión se crea en SU carpeta, con el agente build y con metadata de la comparación.
    const creates = engine.calls
      .filter((c) => c.fn === 'createSession')
      .map((c) => c.args as { directory: string; agent: string; metadata: { compare: string } })
    expect(creates.map((c) => c.directory).sort()).toEqual(m.columns.map((c) => c.worktree!.path).sort())
    expect(creates.every((c) => c.agent === 'build' && c.metadata.compare === id)).toBe(true)
  })

  it('si falla una copia, deshace todas las anteriores (sin carpetas ni ramas)', async () => {
    const { svc } = mk({})
    const id = randomUUID()
    const id8 = id.replace(/-/g, '').slice(0, 8)
    const blocker = worktreePathFor(repo, id8, 1)
    mkdirSync(blocker, { recursive: true })
    writeFileSync(join(blocker, 'x'), 'ocupado')
    await expect(svc.start({ id, mode: 'code', cwd: repo, models: models('a', 'b', 'c'), prompt: 'p' })).rejects.toThrow()
    expect(worktreeCount()).toBe(1)
    expect(branches()).toBe('')
    expect(existsSync(worktreePathFor(repo, id8, 0))).toBe(false)
    expect(await svc.list()).toEqual([])
  })

  it('valida repositorio, commit, número de modelos y una sola comparación activa', async () => {
    const { svc } = mk({ a: { delayMs: 400 }, b: { delayMs: 400 } })
    const notRepo = join(parent, 'plain')
    mkdirSync(notRepo)
    await expect(svc.start({ id: randomUUID(), mode: 'code', cwd: notRepo, models: models('a', 'b'), prompt: 'p' })).rejects.toThrow()
    const empty = join(parent, 'empty')
    mkdirSync(empty)
    g(empty, 'init', '-q')
    await expect(svc.start({ id: randomUUID(), mode: 'code', cwd: empty, models: models('a', 'b'), prompt: 'p' })).rejects.toThrow()
    await expect(svc.start({ id: randomUUID(), mode: 'code', cwd: repo, models: models('a'), prompt: 'p' })).rejects.toThrow()
    await expect(svc.start({ id: randomUUID(), mode: 'code', cwd: repo, models: models('a', 'a'), prompt: 'p' })).rejects.toThrow()
    const id = randomUUID()
    await svc.start({ id, mode: 'code', cwd: repo, models: models('a', 'b'), prompt: 'p' })
    await expect(svc.start({ id: randomUUID(), mode: 'code', cwd: repo, models: models('a', 'b'), prompt: 'p' })).rejects.toThrow()
    await svc.cancel(id)
  })

  it('preflight avisa del árbol sucio y de que no es un repositorio', async () => {
    const { svc } = mk({})
    expect(await svc.preflight(repo)).toMatchObject({ repo: true, clean: true, dirtyFiles: 0 })
    writeFileSync(join(repo, 'nuevo.txt'), 'x')
    const pf = await svc.preflight(repo)
    expect(pf).toMatchObject({ repo: true, clean: false, dirtyFiles: 1 })
    expect(pf.shortHead).toBe(pf.head!.slice(0, 7))
    expect((await svc.preflight(parent)).repo).toBe(false)
  })

  it('«bypass» se rebaja a «auto»: la sesión no permite todo', async () => {
    const { svc, engine } = mk({ a: {}, b: {} })
    const id = randomUUID()
    const m = await svc.start({ id, mode: 'code', cwd: repo, models: models('a', 'b'), prompt: 'p', permissionMode: 'bypass' })
    expect(m.permissionMode).toBe('auto')
    await waitFor(() => allTerminal(svc, id))
    const perms = engine.calls
      .filter((c) => c.fn === 'createSession')
      .map((c) => (c.args as { permission: { permission: string; pattern: string; action: string }[] }).permission)
    for (const p of perms) expect(p).not.toContainEqual({ permission: 'bash', pattern: '*', action: 'allow' })
  })
})

describe('límites de uso', () => {
  it('OpenCode Go: nunca más de 2 sesiones a la vez', async () => {
    const { svc, engine } = mk({ a: { delayMs: 120 }, b: { delayMs: 120 }, c: { delayMs: 120 }, d: { delayMs: 120 } })
    const id = randomUUID()
    await svc.start({
      id,
      mode: 'code',
      cwd: repo,
      models: ['a', 'b', 'c', 'd'].map((modelID) => ({ providerID: 'opencode-go', modelID })),
      prompt: 'p'
    })
    await waitFor(() => allTerminal(svc, id), 8000)
    expect(engine.maxBusyByProvider.get('opencode-go')).toBe(2)
    expect((await states(svc, id)).every((s) => s === 'done')).toBe(true)
  })

  it('cuota: un solo reintento a la misma sesión y, si acierta, termina bien', async () => {
    const { svc, engine } = mk({ a: { quotaFailures: 1, write: { 'a.txt': 'A\n' } }, b: {} })
    const id = randomUUID()
    await svc.start({ id, mode: 'code', cwd: repo, models: models('a', 'b'), prompt: 'p' })
    await waitFor(async () => (await svc.list())[0].columns[0].state === 'rateLimited')
    const waiting = (await svc.list())[0].columns[0]
    expect(waiting.retryAt).not.toBeNull()
    expect(waiting.error?.kind).toBe('quota')
    expect(waiting.retried).toBe(false)
    await waitFor(() => allTerminal(svc, id))
    const col = (await svc.list())[0].columns[0]
    expect(col.state).toBe('done')
    expect(col.retried).toBe(true)
    expect(engine.calls.filter((c) => c.fn === 'prompt' && (c.args as { sessionID: string }).sessionID === col.sessionID)).toHaveLength(2)
    expect(engine.calls.filter((c) => c.fn === 'createSession')).toHaveLength(2)
  })

  it('cuota otra vez tras el reintento: se queda en rateLimited y pausa SOLO a su proveedor', async () => {
    const { svc, engine } = mk({ q: { quotaFailures: Infinity }, other: { write: { 'o.txt': 'o\n' } }, q2: {} }, { staggerMs: 10 })
    const id = randomUUID()
    await svc.start({
      id,
      mode: 'code',
      cwd: repo,
      models: [
        { providerID: 'go', modelID: 'q' },
        { providerID: 'zen', modelID: 'other' },
        { providerID: 'go', modelID: 'q2' }
      ],
      prompt: 'p'
    })
    // q2 es de `go` con 2 plazas libres: arranca; el que importa es que q agota su reintento.
    await waitFor(async () => {
      const c = (await svc.list())[0].columns[0]
      return c.state === 'rateLimited' && c.retryAt === null
    })
    const m = (await svc.list())[0]
    expect(m.columns[0].retried).toBe(true)
    expect(m.pausedProviders).toEqual(['go'])
    await waitFor(async () => (await svc.list())[0].columns[1].state === 'done')
    expect(engine.calls.filter((c) => c.fn === 'prompt' && (c.args as { model: { modelID: string } }).model.modelID === 'q')).toHaveLength(
      2
    )
    // «Reintentar» reanuda el proveedor y vuelve a enviar a la MISMA sesión.
    engine.scripts.q = {}
    await svc.retry(id, 0)
    await waitFor(async () => (await svc.list())[0].columns[0].state === 'done')
    expect((await svc.list())[0].pausedProviders).toEqual([])
  })

  it('si el motor insiste en reintentar por cuota, aborta la columna', async () => {
    const { svc, engine } = mk({ r: { engineRetry: { message: 'token rate limit, retrying', attempt: 3 } }, ok: {} })
    const id = randomUUID()
    await svc.start({ id, mode: 'code', cwd: repo, models: models('r', 'ok'), prompt: 'p' })
    await waitFor(async () => (await svc.list())[0].columns[0].state === 'rateLimited')
    const c = (await svc.list())[0].columns[0]
    expect(c.retryAt).toBeNull()
    expect(engine.count('abort')).toBeGreaterThanOrEqual(1)
  })

  it('un error que no es de cuota termina la columna en error, con el mensaje redactado', async () => {
    const { svc } = mk({
      bad: {
        fail: { name: 'ProviderModelNotFoundError', message: 'Model not found: fake/bad. clave sk-abcdefghijklmnopqrstuvwxyz123456' }
      },
      ok: {}
    })
    const id = randomUUID()
    await svc.start({ id, mode: 'code', cwd: repo, models: models('bad', 'ok'), prompt: 'p' })
    await waitFor(() => allTerminal(svc, id))
    const c = (await svc.list())[0].columns[0]
    expect(c.state).toBe('error')
    expect(c.error?.kind).toBe('model-not-found')
    expect(c.error?.message).not.toContain('sk-abcdefghijklmnopqrstuvwxyz123456')
  })
})

describe('cancelar', () => {
  it('abort + espera de sesión inactiva: queda cancelada y la copia se puede descartar', async () => {
    const { svc, engine } = mk({ slow: { delayMs: 10_000 }, slow2: { delayMs: 10_000 } })
    const id = randomUUID()
    await svc.start({ id, mode: 'code', cwd: repo, models: models('slow', 'slow2'), prompt: 'p' })
    await waitFor(async () => (await states(svc, id)).every((s) => s === 'running'))
    await svc.cancel(id)
    const m = (await svc.list())[0]
    expect(m.columns.map((c) => c.state)).toEqual(['cancelled', 'cancelled'])
    expect(m.columns.every((c) => !c.stopUnconfirmed)).toBe(true)
    expect(engine.count('abort')).toBe(2)
    await svc.discard(id, 0)
    expect(worktreeCount()).toBe(2)
  })

  it('una columna en cola se cancela sin llamar al motor y nunca arranca', async () => {
    const { svc, engine } = mk({ a: { delayMs: 10_000 }, b: {} }, { perProvider: { fake: 1 } })
    const id = randomUUID()
    await svc.start({ id, mode: 'code', cwd: repo, models: models('a', 'b'), prompt: 'p' })
    await waitFor(async () => (await states(svc, id))[0] === 'running')
    expect((await states(svc, id))[1]).toBe('queued')
    await svc.cancel(id, 1)
    expect((await states(svc, id))[1]).toBe('cancelled')
    await svc.cancel(id, 0)
    await new Promise((r) => setTimeout(r, 120))
    expect(engine.calls.filter((c) => c.fn === 'createSession')).toHaveLength(1)
  })

  it('si el motor NO confirma la parada en el tiempo máximo, NO se borra la copia', async () => {
    const { svc } = mk({ stubborn: { delayMs: 600, ignoreAbort: true }, ok: { delayMs: 5000 } })
    const id = randomUUID()
    const m0 = await svc.start({ id, mode: 'code', cwd: repo, models: models('stubborn', 'ok'), prompt: 'p' })
    await waitFor(async () => (await states(svc, id)).every((s) => s === 'running'))
    await svc.cancel(id)
    const m = (await svc.list())[0]
    expect(m.columns[0].state).toBe('cancelled')
    expect(m.columns[0].stopUnconfirmed).toBe(true)
    await expect(svc.discard(id, 0)).rejects.toThrow()
    expect(existsSync(m0.columns[0].worktree!.path)).toBe(true)
    // `close` conserva el manifiesto y esa copia; descarta la otra.
    const res = await svc.close(id)
    expect(res).toEqual({ closed: false, kept: [0] })
    expect(existsSync(m0.columns[0].worktree!.path)).toBe(true)
    expect(existsSync(m0.columns[1].worktree!.path)).toBe(false)
    // Cuando la sesión queda inactiva, ya se puede descartar.
    await waitFor(async () => {
      try {
        await svc.discard(id, 0)
        return true
      } catch {
        return false
      }
    })
    expect(existsSync(m0.columns[0].worktree!.path)).toBe(false)
  })

  it('no se puede descartar una columna en curso', async () => {
    const { svc } = mk({ slow: { delayMs: 10_000 }, slow2: { delayMs: 10_000 } })
    const id = randomUUID()
    await svc.start({ id, mode: 'code', cwd: repo, models: models('slow', 'slow2'), prompt: 'p' })
    await waitFor(async () => (await states(svc, id))[0] === 'running')
    await expect(svc.discard(id, 0)).rejects.toThrow()
    await svc.cancel(id)
  })
})

describe('adoptar', () => {
  const finish = async (svc: CompareService, id: string): Promise<void> => {
    await waitFor(() => allTerminal(svc, id))
    await waitFor(async () => (await svc.list())[0].columns.every((c) => c.state !== 'done' || c.diff !== null))
  }

  it('en limpio aplica el parche entero (nuevos, modificados y binarios) sin commit', async () => {
    const bin = Buffer.from([0, 1, 2, 255, 254, 0, 9])
    const { svc } = mk({
      a: { write: { 'a.txt': 'A\n', 'f.txt': 'two\n', 'img.bin': 'base64:' + bin.toString('base64') } },
      b: { write: { 'b.txt': 'B\n' } }
    })
    const id = randomUUID()
    await svc.start({ id, mode: 'code', cwd: repo, models: models('a', 'b'), prompt: 'p' })
    await finish(svc, id)
    const commits = g(repo, 'rev-list', '--count', 'HEAD').trim()
    const d = await svc.diff(id, 0)
    expect(d.files).toBe(3)
    expect(d.patch).toContain('a.txt')
    expect(d.truncated).toBe(false)
    const r = await svc.adopt(id, 0)
    expect(r).toMatchObject({ ok: true })
    expect(readFileSync(join(repo, 'a.txt'), 'utf8')).toBe('A\n')
    expect(readFileSync(join(repo, 'f.txt'), 'utf8')).toBe('two\n')
    expect(Buffer.compare(readFileSync(join(repo, 'img.bin')), bin)).toBe(0)
    expect(existsSync(join(repo, 'b.txt'))).toBe(false)
    expect(g(repo, 'rev-list', '--count', 'HEAD').trim()).toBe(commits)
    expect(g(repo, 'diff', '--cached', '--name-only').trim()).toBe('')
    expect((await svc.list())[0].columns[0].adopted).toBe(true)
    // La otra columna ya no se puede adoptar.
    expect(await svc.adopt(id, 1)).toMatchObject({ ok: false, reason: 'not-ready' })
  })

  it('con conflicto no deja NINGÚN cambio (git status idéntico antes y después)', async () => {
    const { svc } = mk({ a: { write: { 'new.txt': 'N\n', 'f.txt': 'two\n' } }, b: {} })
    const id = randomUUID()
    await svc.start({ id, mode: 'code', cwd: repo, models: models('a', 'b'), prompt: 'p' })
    await finish(svc, id)
    // HEAD avanza: f.txt cambia en el proyecto y el parche ya no entra.
    writeFileSync(join(repo, 'f.txt'), 'three\n')
    g(repo, 'commit', '-q', '-am', 'otro')
    const before = g(repo, 'status', '--porcelain=v1', '--untracked-files=all')
    const r = await svc.adopt(id, 0)
    expect(r).toMatchObject({ ok: false, reason: 'conflict' })
    expect(g(repo, 'status', '--porcelain=v1', '--untracked-files=all')).toBe(before)
    expect(existsSync(join(repo, 'new.txt'))).toBe(false)
    expect(readFileSync(join(repo, 'f.txt'), 'utf8')).toBe('three\n')
    expect((await svc.list())[0].columns[0].adopted).toBe(false)
  })

  it('dirty-overlap rechaza salvo force; con force sigue exigiendo que el parche entre', async () => {
    const { svc } = mk({ a: { write: { 'f.txt': 'two\n' } }, b: {} })
    const id = randomUUID()
    await svc.start({ id, mode: 'code', cwd: repo, models: models('a', 'b'), prompt: 'p' })
    await finish(svc, id)
    writeFileSync(join(repo, 'f.txt'), 'edición del usuario\n')
    const r = await svc.adopt(id, 0)
    expect(r).toEqual({ ok: false, reason: 'dirty-overlap', files: ['f.txt'] })
    expect(readFileSync(join(repo, 'f.txt'), 'utf8')).toBe('edición del usuario\n')
    // Con force el parche tampoco entra (el contenido base cambió): sigue sin tocarse nada.
    const forced = await svc.adopt(id, 0, true)
    expect(forced).toMatchObject({ ok: false, reason: 'conflict' })
    expect(readFileSync(join(repo, 'f.txt'), 'utf8')).toBe('edición del usuario\n')
  })

  it('un parche vacío devuelve «empty»', async () => {
    const { svc } = mk({ a: {}, b: {} })
    const id = randomUUID()
    await svc.start({ id, mode: 'code', cwd: repo, models: models('a', 'b'), prompt: 'p' })
    await finish(svc, id)
    expect(await svc.adopt(id, 0)).toEqual({ ok: false, reason: 'empty', files: [] })
  })

  it.skipIf(!posixOnly)('no sigue enlaces simbólicos: un parche con symlink se rechaza (symlinks POSIX)', async () => {
    const { svc } = mk({ a: { write: { 'a.txt': 'A\n' }, symlinks: { atajo: '/etc/passwd' } }, b: {} })
    const id = randomUUID()
    await svc.start({ id, mode: 'code', cwd: repo, models: models('a', 'b'), prompt: 'p' })
    await finish(svc, id)
    expect(await svc.adopt(id, 0)).toMatchObject({ ok: false, reason: 'symlink' })
    expect(existsSync(join(repo, 'a.txt'))).toBe(false)
    expect(() => lstatSync(join(repo, 'atajo'))).toThrow()
  })
})

describe('descartar, cerrar y recuperar', () => {
  it('close limpia copias y ramas y borra el manifiesto', async () => {
    const { svc, store } = mk({ a: { write: { 'a.txt': 'A\n' } }, b: {} })
    const id = randomUUID()
    await svc.start({ id, mode: 'code', cwd: repo, models: models('a', 'b'), prompt: 'p' })
    await waitFor(() => allTerminal(svc, id))
    expect(store.list()).toHaveLength(1)
    expect(await svc.close(id)).toEqual({ closed: true, kept: [] })
    expect(worktreeCount()).toBe(1)
    expect(branches()).toBe('')
    expect(store.list()).toEqual([])
    expect(await svc.list()).toEqual([])
    await expect(svc.close(id)).rejects.toThrow()
  })

  it('discard de una columna borra su copia y su rama y no toca las demás', async () => {
    const { svc } = mk({ a: {}, b: {} })
    const id = randomUUID()
    const m = await svc.start({ id, mode: 'code', cwd: repo, models: models('a', 'b'), prompt: 'p' })
    await waitFor(() => allTerminal(svc, id))
    await svc.discard(id, 1)
    expect(existsSync(m.columns[1].worktree!.path)).toBe(false)
    expect(existsSync(m.columns[0].worktree!.path)).toBe(true)
    expect(branches()).toContain(m.columns[0].worktree!.branch)
    expect(branches()).not.toContain(m.columns[1].worktree!.branch)
    const after = (await svc.list())[0].columns[1]
    expect(after.discarded).toBe(true)
    expect(after.worktree).toBeNull()
    await expect(svc.discard(id, 7)).rejects.toThrow()
    await expect(svc.discard(randomUUID(), 0)).rejects.toThrow()
  })

  it('las operaciones de git rechazan ramas sin el prefijo, el worktree principal y rutas ajenas', async () => {
    const id8 = 'deadbeef'
    await expect(removeCompareWorktree(repo, repo, branchFor(id8, 0))).rejects.toThrow()
    await expect(removeCompareWorktree(repo, worktreePathFor(repo, id8, 0), 'main')).rejects.toThrow()
    await expect(removeCompareWorktree(repo, join(parent, 'otra'), branchFor(id8, 0))).rejects.toThrow()
    await expect(createCompareWorktree(repo, worktreePathFor(repo, id8, 0), 'feature/x', 'HEAD')).rejects.toThrow()
    await expect(createCompareWorktree(repo, join(parent, 'fuera'), branchFor(id8, 0), 'HEAD')).rejects.toThrow()
    expect(worktreeCount()).toBe(1)
  })

  it('al arrancar recupera las comparaciones sin cerrar (interrumpidas) sin borrar nada', async () => {
    const a = mk({ slow: { delayMs: 10_000 }, slow2: { delayMs: 10_000 } })
    const id = randomUUID()
    const m = await a.svc.start({ id, mode: 'code', cwd: repo, models: models('slow', 'slow2'), prompt: 'p' })
    await waitFor(async () => (await states(a.svc, id)).every((s) => s === 'running'))
    a.svc.dispose() // «cierre de la app»: el manifiesto queda como estaba
    const b = mk({}, {})
    // otro servicio, mismo userData
    const list = await b.svc.list()
    expect(list).toHaveLength(1)
    expect(list[0].id).toBe(id)
    expect(list[0].columns.map((c) => c.state)).toEqual(['cancelled', 'cancelled'])
    expect(list[0].columns.every((c) => c.interrupted)).toBe(true)
    for (const c of m.columns) expect(existsSync(c.worktree!.path)).toBe(true)
    await expect(b.svc.retry(id, 0)).rejects.toThrow() // no hay prompt en memoria
    expect(await b.svc.close(id)).toEqual({ closed: true, kept: [] })
    expect(worktreeCount()).toBe(1)
    expect(branches()).toBe('')
  })
})

describe('Chat', () => {
  it('sin worktrees: sesiones en la carpeta de Chat con metadata; elegir una y cerrar borra las demás', async () => {
    const { svc, engine } = mk({ a: {}, b: {}, c: {} })
    const id = randomUUID()
    const m = await svc.start({ id, mode: 'chat', models: models('a', 'b', 'c'), prompt: 'hola' })
    expect(m.cwd).toBeNull()
    expect(m.columns.every((c) => c.worktree === null)).toBe(true)
    expect(worktreeCount()).toBe(1)
    await waitFor(() => allTerminal(svc, id))
    const creates = engine.calls
      .filter((c) => c.fn === 'createSession')
      .map((c) => c.args as { directory: string; agent: string; metadata: Record<string, unknown>; permission?: unknown })
    expect(
      creates.every(
        (c) =>
          c.directory === chatDir &&
          c.agent === 'chat' &&
          c.metadata.mode === 'chat' &&
          c.metadata.compare === id &&
          c.permission === undefined
      )
    ).toBe(true)
    expect(await svc.adopt(id, 1)).toEqual({ ok: true, files: [] })
    expect(await svc.close(id)).toEqual({ closed: true, kept: [] })
    const kept = (await svc.list()).length
    expect(kept).toBe(0)
    expect(engine.count('deleteSession')).toBe(2)
    expect(engine.sessions.size).toBe(1)
  })
})

describe('exportación', () => {
  it('no exporta hasta que terminen todas las columnas y no incluye claves', async () => {
    const { svc } = mk({ a: { write: { 'a.txt': 'A\n' }, cost: 0.01, tokens: { input: 10, output: 5 } }, b: { delayMs: 300 } })
    const id = randomUUID()
    await svc.start({ id, mode: 'code', cwd: repo, models: models('a', 'b'), prompt: 'usa sk-abcdefghijklmnopqrstuvwxyz123456' })
    await waitFor(async () => (await states(svc, id))[0] === 'done')
    await expect(svc.buildBench(id)).rejects.toThrow()
    await waitFor(() => allTerminal(svc, id))
    const { fileName, json } = await svc.buildBench(id)
    expect(fileName).toMatch(/^lazunox-compare-[0-9a-f]{8}\.json$/)
    expect(json).not.toContain('sk-abcdefghijklmnopqrstuvwxyz123456')
    const b = JSON.parse(json) as {
      runs: { telemetry: { costUsd: number | null; filesModified: string[] | null }; gitDiff: string | null; cliVersion: string }[]
    }
    expect(b.runs).toHaveLength(2)
    expect(b.runs[0].telemetry.costUsd).toBeCloseTo(0.01)
    expect(b.runs[1].telemetry.costUsd).toBeNull()
    expect(b.runs[0].telemetry.filesModified).toEqual(['a.txt'])
    expect(b.runs[0].gitDiff).toContain('a.txt')
    expect(b.runs[0].cliVersion).toBe('1.18.32')
  })
})

describe('samePath (git lista las copias con «/» en Windows)', () => {
  it('en win32 ignora separadores, barra final y mayúsculas', () => {
    expect(samePath('C:/Users/Me/.proj-worktrees/x-0', 'C:\\users\\me\\.proj-worktrees\\x-0', 'win32')).toBe(true)
    expect(samePath('C:/a/b', 'C:/a/c', 'win32')).toBe(false)
  })
  it('en POSIX la comparación es exacta', () => {
    expect(samePath('/a/b', '/a/b', 'darwin')).toBe(true)
    expect(samePath('/a/B', '/a/b', 'darwin')).toBe(false)
  })
})
