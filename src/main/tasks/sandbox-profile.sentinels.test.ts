/**
 * Lecturas denegadas del sandbox de Tareas (F8-B194).
 *
 * 1) Estructura de `defaultDeniedReadPaths` (todas las plataformas, función pura): las rutas que guardan claves están
 *    en la lista y las que el servidor necesita para trabajar NO.
 * 2) Seatbelt REAL (`sandbox-exec`, solo macOS; se omite en otras plataformas): en un HOME TEMPORAL con archivos
 *    centinela falsos (nunca se lee nada del HOME real de la persona) comprueba que cada ruta endurecida da
 *    «Operation not permitted» y que lo necesario sigue funcionando (carpeta elegida, directorio privado,
 *    herramientas del sistema y `git` con el `GIT_CONFIG_GLOBAL` privado de `sandboxEnv`).
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { macOnly } from '../../test/platform'
import { buildSandboxProfile, defaultDeniedReadPaths, sandboxDirs, sandboxEnv } from './sandbox-profile'

const HOME = '/Users/fixture'

describe('defaultDeniedReadPaths (F8-B194)', () => {
  const list = defaultDeniedReadPaths(HOME)
  const rel = list.map((p) => p.slice(HOME.length + 1))

  it('niega los archivos de arranque del intérprete y la config con claves', () => {
    for (const r of [
      '.zshrc',
      '.zprofile',
      '.zshenv',
      '.bashrc',
      '.bash_profile',
      '.profile',
      '.gitconfig',
      '.netrc',
      '.npmrc',
      '.pypirc',
      '.pgpass',
      '.config',
      '.cache',
      '.npm',
      '.claude',
      '.claude.json',
      '.codex',
      '.cursor',
      '.vscode',
      '.aws',
      '.azure',
      '.kube',
      '.gnupg',
      '.ssh',
      '.docker',
      'Library/Group Containers',
      'Library/HTTPStorages',
      'Library/Cookies',
      'Library/Keychains',
      'Library/Application Support/Claude',
      'Library/Application Support/Code',
      'Library/Application Support/Cursor',
      'Library/Application Support/Slack',
      'Library/Application Support/Google',
      'Library/Application Support/Microsoft',
      'Library/Application Support/Notion',
      'Library/Application Support/MobileSync',
      'Library/Application Support/1Password'
    ]) {
      expect(rel, r).toContain(r)
    }
  })

  it('NO niega lo que el servidor y las herramientas necesitan', () => {
    // `.local/bin` y `.local/share` (uv, pipx), cachés de la app (`Library/Caches`), preferencias (las leen los
    // frameworks del sistema), toolchains del usuario (`.cargo/bin`, `.rustup`, `.nvm`, `.bun`) y `Library` entera.
    for (const r of [
      '',
      'Library',
      'Library/Caches',
      'Library/Preferences',
      'Library/Application Support',
      '.local',
      '.local/bin',
      '.local/share',
      '.cargo',
      '.rustup',
      '.nvm',
      '.bun',
      'Documents',
      'Desktop',
      'Downloads'
    ]) {
      expect(rel, r).not.toContain(r)
    }
  })

  it('todas son absolutas, están dentro del HOME y sin duplicados', () => {
    expect(new Set(list).size).toBe(list.length)
    for (const p of list) expect(p.startsWith(`${HOME}/`), p).toBe(true)
  })

  it('el entorno aislado da a git un archivo global PROPIO (~/.gitconfig denegado haría morir a git)', () => {
    const env = sandboxEnv(sandboxDirs('/x/ud/tasks-sandbox/k'))
    expect(env.GIT_CONFIG_GLOBAL).toBe('/x/ud/tasks-sandbox/k/config/gitconfig')
    expect(env.XDG_CONFIG_HOME).toBe('/x/ud/tasks-sandbox/k/config')
  })
})

// Seatbelt real: solo macOS (en otras plataformas no existe `sandbox-exec`).
describe.skipIf(!macOnly)('Seatbelt real: lecturas denegadas con archivos centinela en un HOME temporal', () => {
  let base: string
  let home: string
  let folder: string
  let priv: string
  let profile: string
  let env: Record<string, string>

  /** Centinelas: archivos (ruta relativa al HOME) y carpetas con un `secret.txt` dentro. */
  const FILES = [
    '.zshrc',
    '.zprofile',
    '.zshenv',
    '.bashrc',
    '.bash_profile',
    '.profile',
    '.gitconfig',
    '.claude.json',
    '.netrc',
    '.npmrc',
    '.pypirc',
    '.pgpass'
  ]
  const DIRS = [
    '.claude',
    '.codex',
    '.cursor',
    '.vscode',
    '.aws',
    '.azure',
    '.kube',
    '.gnupg',
    '.ssh',
    '.docker',
    '.npm',
    '.cache',
    '.config/gcloud',
    '.config/op',
    '.config/algo-ajeno',
    '.config/opencode',
    '.local/share/opencode',
    'Library/Group Containers/group.ejemplo',
    'Library/HTTPStorages',
    'Library/Cookies',
    'Library/Keychains',
    'Library/Application Support/Claude',
    'Library/Application Support/Code',
    'Library/Application Support/Cursor',
    'Library/Application Support/Slack',
    'Library/Application Support/Google/Chrome',
    'Library/Application Support/Microsoft',
    'Library/Application Support/Notion',
    'Library/Application Support/MobileSync'
  ]
  const SENTINEL = 'CENTINELA-FALSO-NO-ES-UNA-CLAVE'

  const sb = (cmd: string[], extraEnv: Record<string, string> = {}): { out: string; status: number | null } => {
    const r = spawnSync('/usr/bin/sandbox-exec', ['-f', profile, ...cmd], {
      encoding: 'utf8',
      timeout: 20000,
      cwd: folder,
      env: { PATH: '/usr/bin:/bin:/usr/sbin:/sbin', HOME: home, ...env, ...extraEnv }
    })
    return { out: `${r.stdout}${r.stderr}`.trim(), status: r.status }
  }

  beforeAll(() => {
    base = realpathSync(mkdtempSync(join(tmpdir(), 'lazunox-sentinels-')))
    home = join(base, 'home')
    folder = join(home, 'trabajo')
    const userData = join(base, 'userData')
    priv = join(userData, 'tasks-sandbox', 'k')
    mkdirSync(folder, { recursive: true })
    const dirs = sandboxDirs(priv)
    for (const d of [dirs.config, dirs.data, dirs.cache, dirs.state, dirs.tmp]) mkdirSync(d, { recursive: true })
    env = sandboxEnv(dirs)
    for (const f of FILES) writeFileSync(join(home, f), `${SENTINEL} ${f}\n`)
    for (const d of DIRS) {
      mkdirSync(join(home, d), { recursive: true })
      writeFileSync(join(home, d, 'secret.txt'), `${SENTINEL} ${d}\n`)
    }
    writeFileSync(join(folder, 'hola.txt'), 'hola\n')
    profile = join(base, 'perfil.sb')
    writeFileSync(profile, buildSandboxProfile({ folder, privateDir: priv, userData, readOnly: [], home }))
  })
  afterAll(() => {
    if (base) rmSync(base, { recursive: true, force: true })
  })

  it('sin perfil los centinelas SÍ se leen (la prueba mide algo real)', () => {
    const r = spawnSync('/bin/cat', [join(home, '.zshrc')], { encoding: 'utf8' })
    expect(r.stdout).toContain(SENTINEL)
  })

  for (const f of FILES) {
    it(`archivo ~/${f}: «Operation not permitted»`, () => {
      const r = sb(['/bin/cat', join(home, f)])
      expect(r.out).toContain('Operation not permitted')
      expect(r.out).not.toContain(SENTINEL)
    })
  }
  for (const d of DIRS) {
    it(`carpeta ~/${d}: leer y listar dan «Operation not permitted»`, () => {
      const r = sb(['/bin/cat', join(home, d, 'secret.txt')])
      expect(r.out).toContain('Operation not permitted')
      expect(r.out).not.toContain(SENTINEL)
      expect(sb(['/bin/ls', join(home, d)]).out).toContain('Operation not permitted')
    })
  }

  it('tampoco se puede ESCRIBIR en las rutas denegadas', () => {
    for (const p of [join(home, '.zshrc'), join(home, '.claude', 'nuevo.txt'), join(home, '.config', 'nuevo.txt')]) {
      const r = sb(['/bin/sh', '-c', `echo x >> "${p}"`])
      expect(r.status, p).not.toBe(0)
      expect(r.out).toContain('Operation not permitted')
    }
    expect(readFileSync(join(home, '.zshrc'), 'utf8')).toBe(`${SENTINEL} .zshrc\n`)
  })

  it('lo necesario sigue funcionando: leer, listar y escribir en la carpeta elegida', () => {
    expect(sb(['/bin/cat', join(folder, 'hola.txt')]).out).toBe('hola')
    expect(sb(['/bin/ls', folder]).out).toContain('hola.txt')
    const w = sb(['/bin/sh', '-c', 'echo resumen > resumen.txt && cat resumen.txt'])
    expect(w.status).toBe(0)
    expect(w.out).toBe('resumen')
    expect(existsSync(join(folder, 'resumen.txt'))).toBe(true)
  })

  it('lo necesario sigue funcionando: directorio privado y temporal del servidor', () => {
    const dirs = sandboxDirs(priv)
    expect(sb(['/bin/sh', '-c', `echo a > "${dirs.data}/a" && echo b > "${dirs.tmp}/b" && cat "${dirs.data}/a" "${dirs.tmp}/b"`]).out).toBe(
      'a\nb'
    )
  })

  it('lo necesario sigue funcionando: intérpretes y herramientas del sistema (con y sin dotfiles denegados)', () => {
    expect(sb(['/bin/zsh', '-c', 'echo zsh-ok']).out).toBe('zsh-ok')
    expect(sb(['/bin/zsh', '-l', '-c', 'echo zsh-login-ok']).out).toBe('zsh-login-ok')
    // bash puede avisar por stderr de que no lee ~/.bashrc (denegado): solo se exige que funcione.
    expect(sb(['/bin/bash', '-c', 'echo bash-ok']).out.split('\n')[0]).toBe('bash-ok')
    expect(sb(['/usr/bin/python3', '-c', 'print("py-ok")']).out).toBe('py-ok')
    expect(sb(['/usr/bin/curl', '--version']).status).toBe(0)
  })

  it('git funciona con el GIT_CONFIG_GLOBAL privado y sin él muere por ~/.gitconfig denegado', () => {
    const repo = join(base, 'repo-fuera') // el repo se prepara FUERA del perfil (crear `.git` exige borrar bloqueos)
    mkdirSync(repo, { recursive: true })
    const g = (args: string[]): ReturnType<typeof spawnSync> =>
      spawnSync('/usr/bin/git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], {
        cwd: repo,
        encoding: 'utf8',
        env: { PATH: '/usr/bin:/bin', HOME: join(base, 'sin-gitconfig'), GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' }
      })
    expect(g(['init', '-q']).status).toBe(0)
    writeFileSync(join(repo, 'a.txt'), 'a\n')
    expect(g(['add', 'a.txt']).status).toBe(0)
    expect(g(['commit', '-q', '-m', 'base']).status).toBe(0)
    // El perfil de esta prueba usa `repo` como carpeta de la tarea.
    const repoProfile = join(base, 'perfil-repo.sb')
    writeFileSync(repoProfile, buildSandboxProfile({ folder: repo, privateDir: priv, home }))
    const run = (extra: Record<string, string>, drop: string[] = []): { out: string; status: number | null } => {
      const e: Record<string, string> = { PATH: '/usr/bin:/bin', HOME: home, ...env, ...extra }
      for (const k of drop) delete e[k]
      const r = spawnSync('/usr/bin/sandbox-exec', ['-f', repoProfile, '/usr/bin/git', 'log', '--oneline'], {
        cwd: repo,
        encoding: 'utf8',
        env: e
      })
      return { out: `${r.stdout}${r.stderr}`.trim(), status: r.status }
    }
    const withPrivate = run({})
    expect(withPrivate.status).toBe(0)
    expect(withPrivate.out).toContain('base')
    const without = run({}, ['GIT_CONFIG_GLOBAL'])
    expect(without.status).not.toBe(0)
    expect(without.out).toContain('Operation not permitted')
    expect(dirname(env.GIT_CONFIG_GLOBAL)).toBe(sandboxDirs(priv).config)
  })
})
