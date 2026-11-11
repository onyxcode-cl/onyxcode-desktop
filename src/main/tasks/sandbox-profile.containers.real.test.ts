/**
 * Seatbelt REAL (`sandbox-exec`): desde dentro no se ejecutan `docker`, `podman`, `nerdctl` ni `kubectl` (por nombre) ni se conecta a sus
 * sockets (1.8.19; idea de Gemini CLI). Los «programas» son guiones de prueba con esos nombres y los sockets son sockets Unix de
 * prueba que abre un proceso de FUERA (que se cierra al terminar). Todo en una carpeta temporal. Solo macOS.
 */
import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { macOnly } from '../../test/platform'
import { buildSandboxProfile, CONTAINER_SOCKET_REGEX, sandboxDirs, sandboxEnv, type SandboxProfileOptions } from './sandbox-profile'

const HAS_SBX = macOnly && existsSync('/usr/bin/sandbox-exec') && existsSync('/usr/bin/python3')
const BUILDERS: Array<[string, (o: SandboxProfileOptions) => string]> = [['V1', buildSandboxProfile]]

/** FUERA: abre los sockets de prueba (argv[1], separados por comas), corre la orden de dentro (el resto) y los cierra. */
const HOST_PY = `import os, socket, subprocess, sys, threading
paths = sys.argv[1].split(',')
srvs = []
for p in paths:
    os.makedirs(os.path.dirname(p), exist_ok=True)
    s = socket.socket(socket.AF_UNIX); s.bind(p); s.listen(5); srvs.append(s)
    def loop(s=s):
        while True:
            try:
                c, _ = s.accept(); c.sendall(b'CENTINELA'); c.close()
            except OSError: return
    threading.Thread(target=loop, daemon=True).start()
r = subprocess.run(sys.argv[2:], capture_output=True, text=True, timeout=60)
print(r.stdout + r.stderr)
for s, p in zip(srvs, paths): s.close(); os.unlink(p)
`
const IN_PY = `import socket, sys
for p in sys.argv[1].split(','):
    try:
        c = socket.socket(socket.AF_UNIX); c.settimeout(3); c.connect(p); print('CONECTA', p, c.recv(20))
    except OSError as e: print('negado', e.errno)
`

describe.skipIf(!HAS_SBX).each(BUILDERS)('Seatbelt real (%s): contenedores', (_j, build) => {
  let dir: string
  let folder: string
  let privateDir: string
  let home: string

  beforeAll(() => {
    // Fuera del temporal del usuario (la jaula V2 no deja leerlo).
    dir = realpathSync(mkdtempSync('/private/tmp/lazunox-contenedores-'))
    folder = join(dir, 'tarea')
    home = join(dir, 'home')
    privateDir = join(dir, 'ud', 'tasks-sandbox', 'abc')
    for (const d of [join(folder, 'bin'), ...Object.values(sandboxDirs(privateDir))]) mkdirSync(d, { recursive: true })
    // Guiones con esos nombres (una copia de un programa del sistema la mata macOS al firmarse distinto).
    for (const n of ['docker', 'podman', 'nerdctl', 'kubectl', 'otro']) {
      writeFileSync(join(folder, 'bin', n), '#!/bin/sh\necho "$1"\n')
      chmodSync(join(folder, 'bin', n), 0o755)
    }
    writeFileSync(join(dir, 'host.py'), HOST_PY)
    writeFileSync(join(dir, 'in.py'), IN_PY)
  })
  afterAll(() => {
    if (dir) rmSync(dir, { recursive: true, force: true })
  })

  const profile = (): string => build({ folder, privateDir, userData: join(dir, 'ud'), home, allowDelete: false })
  const env = (): Record<string, string> => ({ PATH: '/usr/bin:/bin', HOME: home, ...sandboxEnv(sandboxDirs(privateDir)) })

  it('docker, podman, nerdctl y kubectl no se ejecutan (otro programa copiado igual, sí)', () => {
    const r = spawnSync(
      '/usr/bin/sandbox-exec',
      ['-p', profile(), '/bin/sh', '-c', 'for n in docker podman nerdctl kubectl otro; do ./bin/$n "corre-$n"; done; exit 0'],
      { cwd: folder, env: env(), encoding: 'utf8', timeout: 60000 }
    )
    const out = `${r.stdout}${r.stderr}`
    for (const n of ['docker', 'podman', 'nerdctl', 'kubectl']) expect(out).not.toContain(`corre-${n}`)
    expect(out).toContain('corre-otro')
  })

  it('los sockets de Docker, Podman, colima y OrbStack no se alcanzan', () => {
    const socks = [
      join(dir, 's', 'var', 'run', 'docker.sock'),
      join(home, '.docker', 'run', 'docker.sock'),
      join(home, '.colima', 'default', 'docker.sock'),
      join(home, '.orbstack', 'run', 'docker.sock'),
      join(dir, 's', 'podman', 'podman.sock')
    ].join(',')
    const r = spawnSync(
      '/usr/bin/python3',
      [join(dir, 'host.py'), socks, '/usr/bin/sandbox-exec', '-p', profile(), '/usr/bin/python3', join(dir, 'in.py'), socks],
      { cwd: folder, env: env(), encoding: 'utf8', timeout: 90000 }
    )
    const out = `${r.stdout}${r.stderr}`
    expect(out).not.toContain('CONECTA')
    expect(out.match(/negado/g)).toHaveLength(5)
  })

  it('la regla del socket, sola (la red del perfil ya niega todos los sockets Unix): niega esos nombres y deja los demás', () => {
    const socks = [join(dir, 's2', 'docker.sock'), join(dir, 's2', 'podman.sock'), join(dir, 's2', 'otro.sock')].join(',')
    const only = `(version 1)(allow default)(deny network-outbound (remote unix-socket (path-regex #"${CONTAINER_SOCKET_REGEX}")))`
    const r = spawnSync(
      '/usr/bin/python3',
      [join(dir, 'host.py'), socks, '/usr/bin/sandbox-exec', '-p', only, '/usr/bin/python3', join(dir, 'in.py'), socks],
      {
        encoding: 'utf8',
        timeout: 90000
      }
    )
    const out = `${r.stdout}${r.stderr}`
    expect(out.match(/negado/g)).toHaveLength(2)
    expect(out).toContain(`CONECTA ${join(dir, 's2', 'otro.sock')}`)
  })
})
