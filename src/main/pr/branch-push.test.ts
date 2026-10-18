/**
 * Pruebas con repositorios git REALES en carpetas temporales y un remoto «bare» local como `origin`: rama → commit → subida de
 * verdad, sin red y sin GitHub. Cubre la lista blanca de ramas/remotos, las ramas protegidas, la revisión de secretos y que nunca se fuerza.
 */
import { execFileSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { posixOnly } from '../../test/platform'
import { branchChanges, createBranch, listRemotes, push, pushPlan, repoStatus, workingDiff } from './git'

const ghToken = (): string => 'ghp' + '_' + 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8'

let base: string
let cfg: string
const savedEnv: Record<string, string | undefined> = {}

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } }).trim()
}
function write(cwd: string, file: string, text: string): void {
  mkdirSync(join(cwd, file, '..'), { recursive: true })
  writeFileSync(join(cwd, file), text)
}
function commit(cwd: string, file: string, text: string, msg = `cambia ${file}`): string {
  write(cwd, file, text)
  git(cwd, 'add', '--', file)
  git(cwd, 'commit', '-q', '-m', msg)
  return git(cwd, 'rev-parse', 'HEAD')
}

let work: string
let bare: string

beforeAll(() => {
  base = realpathSync(mkdtempSync(join(tmpdir(), 'lzx-pr-git-')))
  cfg = join(base, 'gitconfig')
  writeFileSync(
    cfg,
    '[user]\n\tname = Prueba\n\temail = prueba@example.test\n[init]\n\tdefaultBranch = main\n[commit]\n\tgpgsign = false\n[protocol "file"]\n\tallow = always\n'
  )
  for (const k of ['GIT_CONFIG_GLOBAL', 'GIT_CONFIG_NOSYSTEM']) savedEnv[k] = process.env[k]
  process.env.GIT_CONFIG_GLOBAL = cfg
  process.env.GIT_CONFIG_NOSYSTEM = '1'
})
afterAll(() => {
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
  rmSync(base, { recursive: true, force: true })
})

let n = 0
beforeEach(() => {
  const dir = join(base, `caso-${++n}`)
  mkdirSync(dir)
  bare = join(dir, 'origin.git')
  work = join(dir, 'work')
  git(dir, 'init', '-q', '--bare', '-b', 'main', 'origin.git')
  git(dir, 'init', '-q', '-b', 'main', 'work')
  commit(work, 'README.md', '# hola\n', 'inicio')
  git(work, 'remote', 'add', 'origin', bare)
  git(work, 'push', '-q', 'origin', 'main')
  git(work, 'remote', 'set-head', 'origin', 'main')
})
afterEach(() => undefined)

const bareHas = (ref: string): boolean => {
  try {
    git(bare, 'rev-parse', '--verify', '-q', ref)
    return true
  } catch {
    return false
  }
}

describe('estado del repositorio', () => {
  it('rama, remoto sin credenciales y rama predeterminada', async () => {
    const st = await repoStatus(work)
    expect(st.isRepo).toBe(true)
    expect(st.branch).toBe('main')
    expect(st.protected).toBe(true)
    expect(st.defaultBranch).toBe('main')
    expect(st.remotes).toHaveLength(1)
    expect(st.remotes[0]).toMatchObject({ name: 'origin', url: bare })
    expect(st.head).toMatch(/^[0-9a-f]{40}$/)
  })

  it('muestra la dirección de SUBIDA (pushurl), que es adonde van los datos, y toma el repositorio de la de lectura', async () => {
    git(work, 'remote', 'set-url', 'origin', 'https://github.com/dueno/repo.git')
    git(work, 'remote', 'set-url', '--push', 'origin', bare)
    const [r] = await listRemotes(work)
    expect(r.url).toBe(bare)
    expect(r.slug).toBe('dueno/repo')
    expect(r.host).toBe('github.com')
  })

  it('una carpeta que no es repositorio no lanza', async () => {
    const plain = join(base, 'plano')
    mkdirSync(plain)
    expect((await repoStatus(plain)).isRepo).toBe(false)
  })

  it('oculta usuario y clave de la URL del remoto', async () => {
    git(work, 'remote', 'add', 'fork', 'https://usuario:clave-secreta@example.test/o/r.git')
    const remotes = await listRemotes(work)
    const fork = remotes.find((r) => r.name === 'fork')!
    expect(fork.url).toBe('https://example.test/o/r.git')
    expect(JSON.stringify(remotes)).not.toContain('clave-secreta')
    expect(fork.slug).toBe('o/r')
  })
})

describe('crear rama', () => {
  it('crea y cambia, conservando los cambios sin guardar', async () => {
    write(work, 'pendiente.txt', 'sin guardar')
    const r = await createBranch(work, 'feat/login')
    expect(r.branch).toBe('feat/login')
    expect(git(work, 'branch', '--show-current')).toBe('feat/login')
    expect(git(work, 'status', '--porcelain')).toContain('pendiente.txt')
  })

  it.each(['--force', '-x', 'a b', 'a;b', 'a$(id)', '', 'a..b', 'x.lock', '/abs', 'ñ'])('rechaza %j sin tocar nada', async (name) => {
    await expect(createBranch(work, name)).rejects.toThrow()
    expect(git(work, 'branch', '--show-current')).toBe('main')
    expect(git(work, 'branch', '--format=%(refname:short)')).toBe('main')
  })

  it('rechaza una rama que ya existe', async () => {
    git(work, 'branch', 'ya')
    await expect(createBranch(work, 'ya')).rejects.toMatchObject({ code: 'branch-exists' })
  })
})

describe.skipIf(!posixOnly)('plan de subida y subida real', () => {
  it('rama → commit → plan → subida al remoto local', async () => {
    await createBranch(work, 'feat/a')
    const head = commit(work, 'src/a.ts', 'export const a = 1\n', 'añade a')
    const plan = await pushPlan(work, 'origin')
    expect(plan).toMatchObject({
      branch: 'feat/a',
      head,
      remote: 'origin',
      protected: false,
      remoteBranchExists: false,
      nothingToPush: false,
      commitCount: 1
    })
    expect(plan.commits[0].subject).toBe('añade a')
    expect(plan.files).toEqual(['src/a.ts'])
    expect(plan.blocked).toEqual([])
    const res = await push({ cwd: work, remote: 'origin', branch: 'feat/a', expectHead: head })
    expect(res).toMatchObject({ branch: 'feat/a', remote: 'origin', head })
    expect(bareHas('refs/heads/feat/a')).toBe(true)
    expect(git(bare, 'rev-parse', 'refs/heads/feat/a')).toBe(head)
    // Quedó con upstream y ya no hay nada que subir.
    const st = await repoStatus(work)
    expect(st.upstream).toBe('origin/feat/a')
    expect(st.ahead).toBe(0)
    expect((await pushPlan(work, 'origin')).nothingToPush).toBe(true)
    await expect(push({ cwd: work, remote: 'origin', branch: 'feat/a', expectHead: head })).rejects.toMatchObject({ code: 'nothing' })
  })

  it('si la punta cambió desde que se mostró el diálogo, no sube nada', async () => {
    await createBranch(work, 'feat/b')
    const seen = commit(work, 'b.txt', '1')
    commit(work, 'b2.txt', '2')
    await expect(push({ cwd: work, remote: 'origin', branch: 'feat/b', expectHead: seen })).rejects.toMatchObject({ code: 'changed' })
    expect(bareHas('refs/heads/feat/b')).toBe(false)
  })

  it('si la rama actual no es la que se mostró, no sube nada', async () => {
    await createBranch(work, 'feat/c')
    const head = commit(work, 'c.txt', '1')
    await expect(push({ cwd: work, remote: 'origin', branch: 'feat/otra', expectHead: head })).rejects.toMatchObject({ code: 'changed' })
  })

  it('solo se puede subir a un remoto que ya existe (nunca una URL ni una opción)', async () => {
    await createBranch(work, 'feat/d')
    commit(work, 'd.txt', '1')
    for (const remote of [bare, '--mirror', 'https://example.test/x.git', '../origin.git', 'no-existe']) {
      await expect(pushPlan(work, remote)).rejects.toMatchObject({ code: 'remote-unknown' })
    }
    expect(bareHas('refs/heads/feat/d')).toBe(false)
  })

  it('rama protegida: exige escribir el nombre exacto', async () => {
    const head = commit(work, 'm.txt', 'directo a main')
    const plan = await pushPlan(work, 'origin')
    expect(plan.protected).toBe(true)
    const base = { cwd: work, remote: 'origin', branch: 'main', expectHead: head }
    await expect(push(base)).rejects.toMatchObject({ code: 'protected-confirm' })
    await expect(push({ ...base, typedBranch: 'Main' })).rejects.toMatchObject({ code: 'protected-confirm' })
    await expect(push({ ...base, typedBranch: ' main' })).rejects.toMatchObject({ code: 'protected-confirm' })
    expect(git(bare, 'rev-parse', 'refs/heads/main')).not.toBe(head)
    await push({ ...base, typedBranch: 'main' })
    expect(git(bare, 'rev-parse', 'refs/heads/main')).toBe(head)
  })

  it('una rama «release/…» o la predeterminada del remoto también cuentan como protegidas', async () => {
    await createBranch(work, 'release/1.0')
    commit(work, 'r.txt', '1')
    expect((await pushPlan(work, 'origin')).protected).toBe(true)
  })

  it('un archivo de secretos bloquea la subida (aunque el commit sea válido)', async () => {
    await createBranch(work, 'feat/env')
    const head = commit(work, '.env', 'API_KEY=abc\n', 'config')
    const plan = await pushPlan(work, 'origin')
    expect(plan.blocked).toContainEqual({ kind: 'secret-file', file: '.env' })
    await expect(push({ cwd: work, remote: 'origin', branch: 'feat/env', expectHead: head })).rejects.toMatchObject({ code: 'blocked' })
    expect(bareHas('refs/heads/feat/env')).toBe(false)
  })

  it('.env.example es público y no bloquea', async () => {
    await createBranch(work, 'feat/ejemplo')
    commit(work, '.env.example', 'API_KEY=\n')
    expect((await pushPlan(work, 'origin')).blocked).toEqual([])
  })

  it('una llave dentro de un archivo normal bloquea y no devuelve el valor', async () => {
    await createBranch(work, 'feat/tok')
    const head = commit(work, 'notas.txt', `mi token: ${ghToken()}\n`)
    const plan = await pushPlan(work, 'origin')
    expect(plan.blocked).toEqual([{ kind: 'secret-content', file: 'notas.txt', secrets: ['github-token'] }])
    expect(JSON.stringify(plan)).not.toContain('ghp_')
    await expect(push({ cwd: work, remote: 'origin', branch: 'feat/tok', expectHead: head })).rejects.toMatchObject({ code: 'blocked' })
  })

  it('un secreto que se añadió y luego se borró en otro commit SIGUE bloqueando (viaja en el historial)', async () => {
    await createBranch(work, 'feat/hist')
    commit(work, 'notas.txt', `token ${ghToken()}\n`)
    commit(work, 'notas.txt', 'limpio\n', 'borra el token')
    const plan = await pushPlan(work, 'origin')
    expect(plan.blocked.some((b) => b.kind === 'secret-content')).toBe(true)
  })

  it('una rama ya subida solo revisa lo nuevo', async () => {
    await createBranch(work, 'feat/inc')
    const first = commit(work, 'a.txt', '1')
    await push({ cwd: work, remote: 'origin', branch: 'feat/inc', expectHead: first })
    const second = commit(work, 'b.txt', '2')
    const plan = await pushPlan(work, 'origin')
    expect(plan.commitCount).toBe(1)
    expect(plan.remoteBranchExists).toBe(true)
    await push({ cwd: work, remote: 'origin', branch: 'feat/inc', expectHead: second })
    expect(git(bare, 'rev-parse', 'refs/heads/feat/inc')).toBe(second)
  })

  it('nunca fuerza: si el remoto tiene cambios que no tienes, se rechaza y el remoto queda intacto', async () => {
    await createBranch(work, 'feat/ff')
    const first = commit(work, 'a.txt', '1')
    await push({ cwd: work, remote: 'origin', branch: 'feat/ff', expectHead: first })
    // Otra persona sube a la misma rama.
    const other = join(base, `otra-${n}`)
    git(base, 'clone', '-q', bare, other)
    git(other, 'checkout', '-q', 'feat/ff')
    const theirs = commit(other, 'suyo.txt', 'x')
    git(other, 'push', '-q', 'origin', 'feat/ff')
    // Yo rehago mi historial (un reescritura) y quiero subir.
    git(work, 'reset', '-q', '--hard', 'main')
    const mine = commit(work, 'mio.txt', 'y')
    git(work, 'branch', '--set-upstream-to=origin/feat/ff')
    await expect(push({ cwd: work, remote: 'origin', branch: 'feat/ff', expectHead: mine })).rejects.toMatchObject({ code: 'rejected' })
    expect(git(bare, 'rev-parse', 'refs/heads/feat/ff')).toBe(theirs)
  })

  it('respeta el gancho pre-push del proyecto (no se salta con --no-verify)', async () => {
    await createBranch(work, 'feat/hook')
    const head = commit(work, 'h.txt', '1')
    const hook = join(work, '.git', 'hooks', 'pre-push')
    writeFileSync(hook, '#!/bin/sh\necho "bloqueado por el gancho" >&2\nexit 1\n')
    chmodSync(hook, 0o755)
    await expect(push({ cwd: work, remote: 'origin', branch: 'feat/hook', expectHead: head })).rejects.toMatchObject({
      code: 'push-failed'
    })
    expect(bareHas('refs/heads/feat/hook')).toBe(false)
  })

  it('HEAD suelto: no hay rama que subir', async () => {
    git(work, 'checkout', '-q', '--detach')
    await expect(pushPlan(work, 'origin')).rejects.toMatchObject({ code: 'detached' })
  })
})

describe.skipIf(!posixOnly)('cambios de la rama (para proponer el pull request)', () => {
  it('lista commits, estadística y diff SIN archivos sensibles', async () => {
    await createBranch(work, 'feat/pr')
    commit(work, 'src/x.ts', 'export const x = 1\n', 'añade x')
    commit(work, '.env', 'SECRETO=1\n', 'config')
    const ch = await branchChanges(work, 'origin', 'main')
    expect(ch.commits.map((c) => c.subject)).toEqual(['config', 'añade x'])
    expect(ch.diff).toContain('src/x.ts')
    expect(ch.diff).not.toContain('SECRETO')
    expect(ch.stat).toContain('src/x.ts')
    expect(ch.stat).not.toContain('.env')
  })

  it('base inexistente o inválida', async () => {
    await expect(branchChanges(work, 'origin', 'no-hay')).rejects.toMatchObject({ code: 'base-missing' })
    await expect(branchChanges(work, 'origin', '--output=x')).rejects.toMatchObject({ code: 'branch-invalid' })
  })

  it('los cambios sin guardar tampoco muestran archivos sensibles a la IA', async () => {
    write(work, 'src/y.ts', 'export const y = 2\n')
    write(work, '.env', 'TOKEN_DE_PRUEBA=1\n')
    const wd = await workingDiff(work)
    expect(wd.diff).toContain('src/y.ts')
    expect(wd.diff).not.toContain('TOKEN_DE_PRUEBA')
    expect(wd.files).not.toContain('.env')
    expect(wd.omittedFiles).toBe(1)
  })
})
