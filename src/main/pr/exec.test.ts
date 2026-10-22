import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { posixOnly } from '../../test/platform'
import { findGh, knownGhDirs, minimalEnv, PrError, runFile } from './exec'

const roots: string[] = []
const tmp = (): string => {
  const d = mkdtempSync(join(tmpdir(), 'lzx-pr-exec-'))
  roots.push(d)
  return d
}
afterAll(() => {
  for (const r of roots) rmSync(r, { recursive: true, force: true })
})

describe('entorno mínimo', () => {
  const src: NodeJS.ProcessEnv = {
    PATH: '/usr/bin',
    HOME: '/home/x',
    GH_TOKEN: 'no-debe-pasar',
    GITHUB_TOKEN: 'no-debe-pasar',
    GH_ENTERPRISE_TOKEN: 'no-debe-pasar',
    OPENCODE_SERVER_PASSWORD: 'no-debe-pasar',
    ANTHROPIC_API_KEY: 'no-debe-pasar',
    AWS_SECRET_ACCESS_KEY: 'no-debe-pasar',
    HTTPS_PROXY: 'http://proxy:3128',
    SSH_AUTH_SOCK: '/tmp/agent.sock',
    GIT_ASKPASS: '/tmp/evil',
    GIT_SSH_COMMAND: 'evil',
    LD_PRELOAD: '/tmp/evil.so'
  }
  it('deja pasar solo lo justo y nunca tokens ni variables que cambien cómo corre git', () => {
    const env = minimalEnv(src)
    expect(env.PATH).toBe('/usr/bin')
    expect(env.HOME).toBe('/home/x')
    expect(env.HTTPS_PROXY).toBe('http://proxy:3128')
    expect(env.SSH_AUTH_SOCK).toBe('/tmp/agent.sock')
    for (const k of [
      'GH_TOKEN',
      'GITHUB_TOKEN',
      'GH_ENTERPRISE_TOKEN',
      'OPENCODE_SERVER_PASSWORD',
      'ANTHROPIC_API_KEY',
      'AWS_SECRET_ACCESS_KEY',
      'GIT_ASKPASS',
      'GIT_SSH_COMMAND',
      'LD_PRELOAD'
    ]) {
      expect(env[k]).toBeUndefined()
    }
  })
  it('fija las banderas que evitan preguntas interactivas', () => {
    const env = minimalEnv({})
    expect(env.GIT_TERMINAL_PROMPT).toBe('0')
    expect(env.GH_PROMPT_DISABLED).toBe('1')
    expect(env.GCM_INTERACTIVE).toBe('never')
  })
})

describe.skipIf(!posixOnly)('runFile (sin shell)', () => {
  it('pasa cada argumento tal cual: nada se interpreta', async () => {
    const dir = tmp()
    const evil = 'a; touch pwned && echo $(id) `id` | cat > x'
    const r = await runFile(process.execPath, ['-e', 'process.stdout.write(process.argv[1])', evil], { cwd: dir })
    expect(r.stdout).toBe(evil)
    expect(r.code).toBe(0)
    // Ningún archivo creado por una "inyección".
    const { readdirSync } = await import('node:fs')
    expect(readdirSync(dir)).toEqual([])
  })
  it('devuelve el código de salida sin lanzar', async () => {
    const r = await runFile(process.execPath, ['-e', 'process.stderr.write("mal"); process.exit(3)'])
    expect(r.code).toBe(3)
    expect(r.stderr).toBe('mal')
  })
  it('un programa que no existe lanza not-found', async () => {
    await expect(runFile(join(tmp(), 'no-existe'), [])).rejects.toMatchObject({ code: 'not-found' })
  })
  it('respeta el tiempo límite', async () => {
    await expect(runFile(process.execPath, ['-e', 'setTimeout(()=>{}, 10000)'], { timeoutMs: 200 })).rejects.toBeInstanceOf(PrError)
  })
  it('cierra stdin: un programa que lee la entrada no se cuelga', async () => {
    const r = await runFile(
      process.execPath,
      ['-e', 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write("fin:"+s))'],
      { timeoutMs: 5000 }
    )
    expect(r.stdout).toBe('fin:')
  })
  it('entrega la entrada pedida', async () => {
    const r = await runFile(process.execPath, ['-e', 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(s))'], {
      input: 'hola'
    })
    expect(r.stdout).toBe('hola')
  })
  it('usa el entorno mínimo por defecto (no hereda GH_TOKEN)', async () => {
    process.env.GH_TOKEN = 'secreto-de-prueba'
    try {
      const r = await runFile(process.execPath, ['-e', 'process.stdout.write(String(process.env.GH_TOKEN))'])
      expect(r.stdout).toBe('undefined')
    } finally {
      delete process.env.GH_TOKEN
    }
  })
  it('corta la salida enorme sin reventar y lo avisa', async () => {
    const r = await runFile(process.execPath, ['-e', 'process.stdout.write("x".repeat(200000))'], { maxBuffer: 1000 })
    expect(r.truncated).toBe(true)
  })
})

describe('localizar gh', () => {
  it('busca en el PATH (entradas absolutas) y luego en las carpetas habituales', () => {
    const present = new Set(['/opt/algo/gh', '/opt/homebrew/bin/gh'])
    // Se compara con '/': al simular otra plataforma en Windows, `join` devuelve `\opt\algo\gh`.
    const posix = (p: string | null): string | null => p?.replaceAll('\\', '/') ?? null
    const isFile = (p: string): boolean => present.has(p.replaceAll('\\', '/'))
    expect(posix(findGh({ platform: 'darwin', pathEnv: '/usr/bin:/opt/algo', home: '/h', isFile }))).toBe('/opt/algo/gh')
    expect(posix(findGh({ platform: 'darwin', pathEnv: '/usr/bin', home: '/h', isFile }))).toBe('/opt/homebrew/bin/gh')
    expect(findGh({ platform: 'darwin', pathEnv: '', home: '/h', isFile: () => false })).toBeNull()
  })
  it('ignora entradas relativas del PATH y la carpeta del proyecto', () => {
    const present = new Set(['bin/gh', '/proyecto/gh', '/proyecto/node_modules/.bin/gh'])
    // Se compara con '/': al simular otra plataforma en Windows, `join` devuelve `\opt\algo\gh`.
    const isFile = (p: string): boolean => present.has(p.replaceAll('\\', '/'))
    expect(
      findGh({ platform: 'linux', pathEnv: 'bin:.:/proyecto:/proyecto/node_modules/.bin', home: '/h', isFile, projectDir: '/proyecto' })
    ).toBeNull()
  })
  it('en Windows busca gh.exe en las carpetas de la instalación oficial', () => {
    const dirs = knownGhDirs('win32', 'C:\\Users\\x', { ProgramFiles: 'C:\\Program Files', LOCALAPPDATA: 'C:\\Users\\x\\AppData\\Local' })
    expect(dirs.some((d) => d.includes('GitHub CLI'))).toBe(true)
  })
  it('encuentra un ejecutable real en una carpeta del PATH', () => {
    if (!posixOnly) return
    const d = tmp()
    mkdirSync(join(d, 'bin'))
    writeFileSync(join(d, 'bin', 'gh'), '#!/bin/sh\n', { mode: 0o755 })
    expect(findGh({ pathEnv: join(d, 'bin'), projectDir: join(d, 'otro') })).toBe(join(d, 'bin', 'gh'))
  })
})
