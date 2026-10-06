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
    // El interop se decide por el wsl.conf de la distro (`[interop] enabled=false`), no por el registro binfmt del núcleo, que es de todas las distros.
    expect(launcher).toMatch(/if interop_active\(\):\s*\n\s*die\("el interop de WSL está activo/)
    expect(launcher).toContain('/etc/wsl.conf')
    expect(launcher).not.toContain('binfmt_misc/WSLInterop')
    expect(launcher).toMatch(/landlock\.abi_version\(\) < init\["landlock"\]\["minAbi"\]/)
    expect(launcher).toContain('CLONE_NEWNS | CLONE_NEWPID | CLONE_NEWNET')
  })
  it('monta con drvfs_options (noexec,nosuid,nodev) y el servidor corre como lazunox con Landlock antes del exec', () => {
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

describe('launcher.py: probe ampliado y subcomandos de datos', () => {
  const launcher = code('launcher.py')
  it('el probe informa rootfs, payloadSha, driveMounts y wslSystemMounts (virtiofs cuenta como unidad)', () => {
    for (const k of ['"rootfs"', '"payloadSha"', '"driveMounts"', '"wslSystemMounts"']) expect(launcher).toContain(k)
    expect(launcher).toContain('NET_FSTYPES = ("9p", "drvfs", "virtiofs")')
    expect(launcher).toContain('startswith("fuse")')
  })
  it('subcomandos --export-home, --import-home, --du y --rm; la clave se valida y no se sigue ningún enlace', () => {
    for (const k of ['--export-home', '--import-home', '--du', '--rm']) expect(launcher).toContain(`"${k}"`)
    expect(launcher).toContain('KEY_RE = re.compile(r"^[0-9a-f]{16}\\Z")')
    expect(launcher).not.toMatch(/extractall|followlinks\s*=\s*True/)
  })
})

describe('rootfs/lazunox-install: análisis estático', () => {
  const inst = code('rootfs/lazunox-install')
  it('sin shell, sin red y sin extractall; el miembro del tgz se lee con extractfile', () => {
    expect(inst).not.toMatch(/shell\s*=\s*True|os\.system|subprocess|socket|urllib|extractall|\.extract\(/)
    expect(inst).toContain('extractfile(')
  })
  it('la raíz de prueba solo con LAZUNOX_INSTALL_TEST=1 y uid != 0; la instalación es por .new y renombrado', () => {
    expect(inst).toMatch(/os\.getuid\(\) == 0 or os\.environ\.get\("LAZUNOX_INSTALL_TEST"\) != "1"/)
    expect(inst).toContain('lazunox.new')
    expect(inst).toContain('os.rename(new, target)')
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
  it('protocol.py, mux.py, el lanzador y el instalador pasan sus pruebas', () => {
    const r = spawnSync('python3', ['-m', 'unittest', 'test_protocol', 'test_install'], {
      cwd: dir,
      encoding: 'utf8',
      timeout: 60_000,
      env: { PATH: process.env.PATH ?? '', PYTHONDONTWRITEBYTECODE: '1' }
    })
    expect(r.stderr + r.stdout).toMatch(/OK/)
    expect(r.status).toBe(0)
  }, 70_000)
})
