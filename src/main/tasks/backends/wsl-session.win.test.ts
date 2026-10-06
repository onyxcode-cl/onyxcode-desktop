/**
 * Integración REAL de una SESIÓN de Tareas en Windows (solo en el PC Windows de pruebas). Sigue a `wsl-setup.win.test.ts`:
 * instala la distro dedicada `Lazunox-Tareas`, comprueba `status()==='ready'`, arranca el sandbox con el backend REAL
 * (`wsl.exe` de verdad + puente del lado anfitrión), espera la salud de OpenCode por el puente y comprueba de forma POSITIVA el flujo
 * legítimo: usuario `lazunox` sin capacidades, carpeta aprobada montada con `noexec,nosuid,nodev`, un archivo creado desde dentro
 * aparece en Windows, parada sin procesos huérfanos en la distro y `remove()`. No es una batería de ataques.
 *
 * Se salta salvo en win32 con `LAZUNOX_WSL_IT=1`; se niega a correr si ya existe `Lazunox-Tareas`; nunca `--shutdown`; no toca otras
 * distros. Todo lo que crea vive bajo `C:\onyx\tmp` y `C:\onyx\wsl`.
 *
 * Cómo se mira DENTRO sin ampliar la lista cerrada de `wsl.exe` de producción: el propio servidor (que corre como `lazunox`, en el
 * mismo espacio de montaje y con Landlock) lanza un `sh -c` por su API (`POST /pty`, o `POST /session/<id>/shell` si el primero no
 * existe) que escribe la evidencia en la carpeta aprobada; la prueba la lee desde Windows. Solo la comprobación de huérfanos usa un
 * `wsl.exe -d Lazunox-Tareas -u root --exec /bin/sh -c …` propio de la prueba, acotado a la distro de prueba y de solo lectura.
 */
import { execFile } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { createServer } from 'node:net'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createWslBackend } from './wsl'
import { IT_ENABLED, IT_TMP, createItEnv, pinnedOpencodeVersion } from './wsl-it-support'
import { realConnect } from './wsl-real-deps'
import { WSL_DISTRO, wslEnv } from './wsl-spec'

const HOST = '127.0.0.1'
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createServer()
    s.once('error', reject)
    s.listen(0, HOST, () => {
      const port = (s.address() as { port: number }).port
      s.close(() => resolve(port))
    })
  })
}

async function until<T>(what: string, ms: number, fn: () => Promise<T | null | undefined | false>, every = 500): Promise<T> {
  const end = Date.now() + ms
  let last: unknown
  while (Date.now() < end) {
    try {
      const v = await fn()
      if (v) return v
    } catch (e) {
      last = e
    }
    await sleep(every)
  }
  throw new Error(`tiempo agotado esperando: ${what}${last ? ` (${last instanceof Error ? last.message : String(last)})` : ''}`)
}

/** Procesos de la distro (todo el espacio de PID de la distro) como «pid cmdline», sin depender de `ps`. Solo lectura. */
const LIST_PROCS = `for d in /proc/[0-9]*; do printf '%s ' "\${d#/proc/}"; tr '\\0' ' ' < "$d/cmdline" 2>/dev/null; echo; done`
function distroProcesses(hostEnv: Record<string, string | undefined>): Promise<string[]> {
  return distroSh(hostEnv, LIST_PROCS)
}
/** Diagnóstico de SOLO LECTURA: las últimas líneas del registro de opencode dentro de la distro de prueba. */
const TAIL_OPENCODE_LOG =
  'd=$(ls -d /home/lazunox/xdg/*/data/opencode 2>/dev/null | head -1); echo "dir=$d"; ls -la "$d" "$d/log" 2>&1 | head -24; echo ---ERR---; grep -rhi "error\\|denied\\|EACCES\\|EPERM\\|sqlite" "$d/log" 2>/dev/null | tail -10'
;('f=$(ls -t /home/lazunox/xdg/*/data/opencode/log/*.log 2>/dev/null | head -1); echo "log=$f"; [ -n "$f" ] && tail -n 30 "$f"')
function distroSh(hostEnv: Record<string, string | undefined>, cmd: string): Promise<string[]> {
  const env = wslEnv(hostEnv)
  const args = ['-d', WSL_DISTRO, '-u', 'root', '--cd', '/', '--exec', '/bin/sh', '-c', cmd]
  if (args[1] !== 'Lazunox-Tareas') throw new Error('solo la distro de prueba')
  return new Promise((resolve, reject) => {
    execFile(
      `${env.SystemRoot ?? 'C:\\Windows'}\\System32\\wsl.exe`,
      args,
      { env, windowsHide: true, timeout: 30_000, encoding: 'buffer' },
      (err, stdout) => (err ? reject(err) : resolve(stdout.toString('utf8').split(/\r?\n/).filter(Boolean)))
    )
  })
}
const ours = (l: string): boolean => /\/opt\/lazunox\/(bin\/opencode|launcher\.py)/.test(l)

/** `sh` que corre DENTRO del sandbox (como `lazunox`, con Landlock). Escribe la evidencia en `ev/` y al final crea `ev/done`. */
function evidenceScript(token: string): string {
  return [
    'mkdir -p ev',
    'id -u > ev/uid.txt',
    "grep -E '^(Uid|Gid|CapEff|NoNewPrivs):' /proc/self/status > ev/status.txt",
    "grep -F ' /win/' /proc/self/mountinfo > ev/mounts.txt",
    'cat nota.txt > ev/nota-leida.txt',
    `printf 'creado-desde-wsl-${token}\\n' > desde-wsl.txt`,
    // case=off: crear con un nombre y buscarlo con otras mayúsculas.
    'printf x > Caso.TXT',
    'if [ -e caso.txt ]; then echo yes > ev/case.txt; else echo no > ev/case.txt; fi',
    // Sin `allowDelete` la carpeta no concede borrar (Landlock): el archivo debe seguir ahí.
    'printf z > borrame.txt',
    'rm -f borrame.txt 2>/dev/null',
    'if [ -e borrame.txt ]; then echo kept > ev/rm.txt; else echo removed > ev/rm.txt; fi',
    'echo done > ev/done'
  ].join('\n')
}

describe.skipIf(!IT_ENABLED)('sesión real de Tareas con wsl.exe y el puente (PC Windows, LAZUNOX_WSL_IT=1)', () => {
  it(
    'arranca el sandbox, responde por el puente, monta la carpeta aprobada, no deja huérfanos y se quita',
    async () => {
      const env = await createItEnv({ real: true })
      const backend = createWslBackend(env.deps)
      const before = await env.list()
      expect(before.includes(WSL_DISTRO), 'ya existe Lazunox-Tareas: no se pisa').toBe(false)

      const runId = `lzx-ses-${randomBytes(3).toString('hex')}`
      const runDir = join(IT_TMP, runId)
      const folder = join(runDir, 'work')
      const configDir = join(runDir, 'cfg')
      const privateDir = join(runDir, randomBytes(8).toString('hex'))
      const token = randomBytes(8).toString('hex')
      const notaText = `contenido-conocido-${token}\n`
      let launched: Awaited<ReturnType<typeof backend.launch>> | undefined
      const stderrTail: string[] = []

      try {
        await backend.setup!(() => undefined)
        expect((await backend.status()).state).toBe('ready')

        await mkdir(folder, { recursive: true })
        // Como hace el gestor antes de lanzar (migrateFolderScratch): la política de Landlock incluye `<carpeta>/.lazunox/trabajo` y debe existir.
        await mkdir(join(folder, '.lazunox', 'trabajo'), { recursive: true })
        await mkdir(configDir, { recursive: true })
        // Como opencode-config.ts: OpenCode escribe este .gitignore si falta, y la carpeta de configuración va de solo lectura.
        await writeFile(
          join(configDir, '.gitignore'),
          ['node_modules', 'package.json', 'package-lock.json', 'bun.lock', '.gitignore'].join('\n'),
          'utf8'
        )
        await mkdir(privateDir, { recursive: true })
        await writeFile(join(folder, 'nota.txt'), notaText)
        await writeFile(join(configDir, 'LEEME.txt'), 'config de prueba (solo lectura)\n')

        const port = await freePort()
        const password = randomBytes(24).toString('base64url')
        const authorization = `Basic ${Buffer.from(`tasks:${password}`).toString('base64')}`
        launched = await backend.launch({
          folder,
          bin: '',
          serveArgs: ['serve', '--port', String(port), '--hostname', HOST, '--print-logs', '--log-level', 'DEBUG'],
          serverPort: port,
          isolation: { privateDir, userData: join(runDir, 'userdata') },
          configDir,
          allowDelete: false,
          outboundPorts: [],
          baseEnv: {
            OPENCODE_SERVER_USERNAME: 'tasks',
            OPENCODE_SERVER_PASSWORD: password,
            OPENCODE_DISABLE_AUTOUPDATE: '1',
            // Sin salida de red (outboundPorts vacío): no intentar bajar la lista de modelos (en el flujo real sale por el proxy controlado).
            OPENCODE_DISABLE_MODELS_FETCH: '1',
            LAZUNOX_TASKS_FOLDER: folder
          },
          proxyEnv: {}
        })
        const child = launched.child
        child.stderr?.on('data', (d: Buffer) => stderrTail.push(d.toString()))
        const exited = new Promise<number | null>((resolve) => child.once('exit', (code) => resolve(code)))
        let died: number | null | undefined
        void exited.then((c) => (died = c))
        const api = async (path: string, init?: RequestInit): Promise<Response> =>
          fetch(`http://${HOST}:${port}${path}`, {
            ...init,
            headers: { authorization, 'content-type': 'application/json' },
            signal: AbortSignal.timeout(15_000)
          })

        // 1) Salud por el puente, con la versión fijada.
        const health = await until('/global/health por el puente', 120_000, async () => {
          if (died !== undefined) throw new Error(`el lanzador salió (${died}): ${stderrTail.slice(-5).join('').trim()}`)
          try {
            const r = await api('/global/health')
            return r.ok ? ((await r.json()) as { healthy?: boolean; version?: string }) : null
          } catch (e) {
            // Diagnostico: causa de red y lo que dijo el lanzador/servidor por stderr (sin credenciales: la contraseña va en el entorno).
            const cause = (e as { cause?: { code?: string } }).cause?.code ?? ''
            throw new Error(`${e instanceof Error ? e.message : String(e)} ${cause} | stderr: ${stderrTail.join('').trim().slice(-900)}`)
          }
        })
        expect(health.healthy).toBe(true)
        expect(health.version).toBe(await pinnedOpencodeVersion())

        // 2) Dentro del sandbox: el servidor lanza un `sh` que deja la evidencia en la carpeta aprobada.
        const linuxFolder = launched.mounts!.find((m) => m.win.toLowerCase() === folder.toLowerCase())!.linux
        const linuxCfg = launched.mounts!.find((m) => m.win.toLowerCase() === configDir.toLowerCase())!.linux
        expect(linuxFolder.startsWith('/win/c/onyx/tmp/')).toBe(true)
        const script = evidenceScript(token)
        const pty = await api(`/pty?directory=${encodeURIComponent(linuxFolder)}`, {
          method: 'POST',
          body: JSON.stringify({ command: '/bin/sh', args: ['-c', script], cwd: linuxFolder })
        })
        if (!pty.ok) {
          // Variante sin PTY: comando de shell de una sesión (no necesita el modelo para ejecutarse, solo un agente).
          const ses = await api(`/session?directory=${encodeURIComponent(linuxFolder)}`, {
            method: 'POST',
            body: JSON.stringify({ title: 'it' })
          })
          const ptyBody = (
            await pty
              .clone()
              .text()
              .catch(() => '')
          ).slice(0, 400)
          const sesBody = (
            await ses
              .clone()
              .text()
              .catch(() => '')
          ).slice(0, 400)
          const ocLog = (await distroSh(env.hostEnv, TAIL_OPENCODE_LOG).catch((e: unknown) => [String(e)])).join(' | ').slice(-1500)
          expect(
            ses.ok,
            `ni /pty (${pty.status}: ${ptyBody}) ni /session (${ses.status}: ${sesBody}) | stderr: ${stderrTail.join('').trim().slice(-2500)} | opencode.log: ${ocLog}`
          ).toBe(true)
          const { id } = (await ses.json()) as { id: string }
          const sh = await api(`/session/${id}/shell?directory=${encodeURIComponent(linuxFolder)}`, {
            method: 'POST',
            body: JSON.stringify({ agent: 'build', command: script })
          })
          expect(sh.ok, `ni /pty (${pty.status}) ni /session/shell (${sh.status})`).toBe(true)
        }
        const ev = join(folder, 'ev')
        await until('ev/done (el sh de dentro terminó)', 60_000, async () => {
          if (died !== undefined) throw new Error('el lanzador salió')
          return (await readFile(join(ev, 'done'), 'utf8').catch(() => '')).trim() === 'done'
        })
        const read = async (n: string): Promise<string> => readFile(join(ev, n), 'utf8')

        // Usuario `lazunox` (uid 1000), sin capacidades, NO_NEW_PRIVS.
        expect((await read('uid.txt')).trim()).toBe('1000')
        const status = await read('status.txt')
        expect(status).toMatch(/^Uid:\s+1000\s+1000\s+1000\s+1000$/m)
        expect(status).toMatch(/^CapEff:\s+0+$/m)
        expect(status).toMatch(/^NoNewPrivs:\s+1$/m)

        // Montajes: la carpeta aprobada (rw) y la config (ro), con noexec,nosuid,nodev.
        const mounts = (await read('mounts.txt')).split(/\r?\n/).filter(Boolean)
        const info = (mp: string): { opts: string[]; rest: string } => {
          const line = mounts.find((l) => l.split(' ')[4] === mp)
          expect(line, `no hay montaje en ${mp}: ${mounts.join(' | ')}`).toBeTruthy()
          const [head, tail] = line!.split(' - ')
          return { opts: head!.split(' ')[5]!.split(','), rest: tail! }
        }
        const main = info(linuxFolder)
        for (const o of ['rw', 'noexec', 'nosuid', 'nodev']) expect(main.opts, `opciones de ${linuxFolder}: ${main.opts}`).toContain(o)
        const cfg = info(linuxCfg)
        for (const o of ['ro', 'noexec', 'nosuid', 'nodev']) expect(cfg.opts, `opciones de ${linuxCfg}: ${cfg.opts}`).toContain(o)
        console.log(`[wsl-session] montaje principal: ${mounts.find((l) => l.split(' ')[4] === linuxFolder)}`)
        // case=off: se comprueba por COMPORTAMIENTO (`Caso.TXT` visible como `caso.txt`); la opción puede no aparecer literal en mountinfo.
        expect((await read('case.txt')).trim(), 'case=off: el montaje distingue mayúsculas').toBe('yes')
        console.log(`[wsl-session] case=off literal en mountinfo: ${/case=off/.test(main.rest)}`)

        // Lectura y escritura de punta a punta.
        expect(await read('nota-leida.txt')).toBe(notaText)
        expect(await readFile(join(folder, 'desde-wsl.txt'), 'utf8')).toBe(`creado-desde-wsl-${token}\n`)
        // Landlock sin `allowDelete`: borrar no está concedido.
        expect((await read('rm.txt')).trim(), 'sin allowDelete el rm debe fallar').toBe('kept')

        // Procesos: con el sandbox en marcha hay opencode y el lanzador en la distro.
        const running = (await distroProcesses(env.hostEnv)).filter(ours)
        expect(running.some((l) => l.includes('/opt/lazunox/bin/opencode'))).toBe(true)
        expect(running.some((l) => l.includes('launcher.py'))).toBe(true)

        // 3) Parar la sesión: el proceso de wsl.exe sale y no queda nada nuestro en la distro.
        child.kill('SIGTERM')
        await until('salida de wsl.exe', 20_000, async () => (child.exitCode !== null || child.signalCode !== null) && true)
        await until(
          'sin procesos de Tareas en la distro',
          20_000,
          async () => (await distroProcesses(env.hostEnv)).filter(ours).length === 0,
          1000
        )
        await until(
          'puerto del servidor cerrado en 127.0.0.1',
          15_000,
          async () => {
            try {
              ;(await realConnect(port)).destroy()
              return false
            } catch {
              return true
            }
          },
          500
        )
        await launched.dispose()
      } finally {
        if (launched && launched.child.exitCode === null) launched.child.kill('SIGKILL')
        await backend.remove!()
        await rm(runDir, { recursive: true, force: true })
      }
      expect(await env.list()).toEqual(before)
    },
    25 * 60_000
  )
})
