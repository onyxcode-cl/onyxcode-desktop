/**
 * El lanzador de Python (`resources/wsl/*.py`) NO se ejecuta aquí: análisis estático y las pruebas de su parte pura
 * (`python3 -m unittest`, solo si hay python3; sin llamadas privilegiadas, nunca importa launcher.py).
 */
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const dir = join(process.cwd(), 'resources/wsl')
const read = (f: string): string => readFileSync(join(dir, f), 'utf8')
/** Sin comentarios ni docstrings: la documentación puede nombrar lo prohibido. */
const code = (f: string): string =>
  read(f)
    .replace(/"""[\s\S]*?"""/g, '')
    .replace(/(^|\s)#[^\n]*/g, '$1')

const py = spawnSync('python3', ['--version'], { encoding: 'utf8' })
const hasPython = py.status === 0

describe('launcher.py: análisis estático', () => {
  const launcher = code('launcher.py')
  it('sin shell, sin interop, sin credenciales y sin apagar WSL', () => {
    expect(launcher).not.toMatch(/shell\s*=\s*True|os\.system|cmd\.exe|powershell|wsl\.exe|\.exe['"]/i)
    expect(launcher).not.toMatch(/shutdown|auth\.json|OPENCODE_AUTH_CONTENT|readProviderAuth|Bearer/)
  })
  it('se niega a arrancar con interop activo o sin Landlock, y usa los tres espacios de nombres', () => {
    expect(launcher).toContain('WSLInterop')
    expect(launcher).toMatch(/landlock\.abi_version\(\) < init\["landlock"\]\["minAbi"\]/)
    expect(launcher).toContain('CLONE_NEWNS | CLONE_NEWPID | CLONE_NEWNET')
  })
  it('monta con drvfs_options (noexec,nosuid,nodev) y el servidor corre como onyx con Landlock antes del exec', () => {
    expect(launcher).toContain('P.drvfs_options(m["mode"])')
    const a = launcher.indexOf('os.setuid(P.WSL_UID)')
    const b = launcher.indexOf('landlock.apply_policy(')
    const c = launcher.indexOf('os.execve(')
    expect(a).toBeGreaterThan(0)
    expect(b).toBeGreaterThan(a)
    expect(c).toBeGreaterThan(b)
    expect(launcher).toContain('os.setgroups([])')
  })
  it('la trama INIT se valida antes de cualquier efecto', () => {
    const main = launcher.slice(launcher.indexOf('def main()'))
    const v = main.indexOf('P.validate_init(')
    expect(v).toBeGreaterThan(0)
    for (const effect of ['isolate_namespaces()', 'os.fork()', 'namespace_init(init)']) expect(main.indexOf(effect)).toBeGreaterThan(v)
  })
})

describe('landlock.py / protocol.py / mux.py', () => {
  it('Landlock falla cerrado y no maneja TRUNCATE', () => {
    const l = code('landlock.py')
    expect(l).toContain('raise LandlockError')
    expect(l).toContain('NO_NEW_PRIVS')
    expect(code('protocol.py')).not.toMatch(/TRUNCATE/)
  })
  it('el multiplexor solo conecta a 127.0.0.1', () => {
    const m = code('mux.py')
    expect(m).toContain('LOOPBACK = "127.0.0.1"')
    expect(m).not.toMatch(/0\.0\.0\.0|AF_INET6|gethostbyname|getaddrinfo/)
  })
})

describe.skipIf(!hasPython)('parte pura del lanzador (python3 -m unittest)', () => {
  it('protocol.py y mux.py pasan sus pruebas', () => {
    const r = spawnSync('python3', ['-m', 'unittest', 'test_protocol'], {
      cwd: dir,
      encoding: 'utf8',
      timeout: 60_000,
      env: { PATH: process.env.PATH ?? '', PYTHONDONTWRITEBYTECODE: '1' }
    })
    expect(r.stderr + r.stdout).toMatch(/OK/)
    expect(r.status).toBe(0)
  }, 70_000)
})
