/**
 * Seatbelt REAL (`sandbox-exec`, sin Electron ni modelos): dentro del perfil de Tareas el agente no puede
 * consultar por libproc (`proc_pidpath`, `proc_pidinfo`: ruta, tareas, uso de recursos) OTROS procesos, pero sí
 * el PROPIO. Solo macOS.
 *
 * LÍMITE VERIFICADO (macOS 27/Darwin 27): `sysctl(KERN_PROCARGS2)` (lo que usan `ps eww`/`ps -E` para leer
 * argumentos y ENTORNO de otro proceso del mismo usuario) NO pasa por ninguna operación Seatbelt denegable:
 * ni `process-info*`, ni `sysctl*`, ni `signal`, `mach*`, `ipc*`, `system*`, `iokit*`… (probado una a una con
 * `(allow default)(deny <op>)`). Por eso aquí NO se afirma que falle; `procargs2 ajeno` queda como límite
 * documentado en docs/SEGURIDAD.md. Si una versión de macOS lo cerrara, cambia el último caso.
 * (`/proc` no existe en macOS.)
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { mkdtempSync, rmSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildSandboxProfile } from './sandbox-profile'
import { macOnly } from '../../test/platform'

// proc_pidpath + proc_pidinfo(PROC_PIDTASKINFO) del pid dado (0 = el propio). Imprime los retornos.
const PY_LIBPROC = `
import ctypes, sys, os
l = ctypes.CDLL('/usr/lib/libproc.dylib', use_errno=True)
pid = int(sys.argv[1]) or os.getpid()
b = ctypes.create_string_buffer(4096)
p = l.proc_pidpath(pid, b, 4096)
i = l.proc_pidinfo(pid, 4, 0, ctypes.create_string_buffer(4096), 4096)
print('pidpath=%d pidinfo=%d' % (p, i))
`

describe.skipIf(!macOnly)('Seatbelt real: process-info hacia otros procesos', () => {
  let dir: string
  let victim: ChildProcess
  let profile: string

  beforeAll(() => {
    dir = realpathSync(mkdtempSync(join(tmpdir(), 'lazunox-procinfo-')))
    profile = buildSandboxProfile({ folder: join(dir, 'f'), privateDir: join(dir, 'p'), home: join(dir, 'home') })
    victim = spawn(process.execPath, ['-e', 'setTimeout(()=>{},120000)'], { stdio: 'ignore' })
  })
  afterAll(() => {
    if (victim?.pid) victim.kill('SIGKILL')
    rmSync(dir, { recursive: true, force: true })
  })

  const run = (sandboxed: boolean, cmd: string[]): { out: string; status: number | null } => {
    const argv = sandboxed ? ['/usr/bin/sandbox-exec', '-p', profile, ...cmd] : cmd
    const r = spawnSync(argv[0], argv.slice(1), { encoding: 'utf8', timeout: 20000 })
    return { out: `${r.stdout}${r.stderr}`.trim(), status: r.status }
  }

  it('control: sin sandbox libproc SÍ ve a otro proceso (la prueba detecta el hueco)', () => {
    expect(run(false, ['/usr/bin/python3', '-c', PY_LIBPROC, String(victim.pid)]).out).toMatch(/pidpath=[1-9]\d* pidinfo=[1-9]\d*/)
  })

  it('el perfil niega proc_pidpath/proc_pidinfo de OTRO proceso', () => {
    expect(run(true, ['/usr/bin/python3', '-c', PY_LIBPROC, String(victim.pid)]).out).toBe('pidpath=0 pidinfo=0')
  })

  it('lo legítimo sigue: libproc sobre el PROPIO proceso, bash, git, node, python3', () => {
    expect(run(true, ['/usr/bin/python3', '-c', PY_LIBPROC, '0']).out).toMatch(/pidpath=[1-9]\d* pidinfo=[1-9]\d*/)
    expect(run(true, ['/bin/bash', '-c', 'echo ok-bash']).out).toContain('ok-bash')
    expect(run(true, ['/usr/bin/git', '--version']).out).toContain('git version')
    expect(run(true, [process.execPath, '-e', 'console.log("ok-node")']).out).toContain('ok-node')
    expect(run(true, ['/usr/bin/python3', '-c', 'print("ok-py")']).out).toContain('ok-py')
  })

  it('perfil: process-info* denegado salvo (target self)', () => {
    expect(profile).toContain('(deny process-info*)')
    expect(profile).toContain('(allow process-info* (target self))')
    expect(profile.indexOf('(deny process-info*)')).toBeLessThan(profile.indexOf('(allow process-info* (target self))'))
  })
})
