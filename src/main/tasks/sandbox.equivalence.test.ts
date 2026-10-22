/**
 * Equivalencia byte a byte del lanzamiento Seatbelt (F8-B81, extracción de `backends/seatbelt`).
 *
 * El fixture `__fixtures__/seatbelt-before.json` se capturó ejecutando el código de `sandbox.ts`
 * ANTES de extraer el backend (commit previo). Esta prueba ejecuta `startTasksServer` y
 * `writeSandboxProfile` con dobles (sin Electron, sin red, sin `sandbox-exec`) y compara, para
 * entradas fijas: perfil SBPL, `command`, `args`, `env` y opciones de `spawn`, constructores de los
 * proxies, `trackPid`, `killTree` y limpieza. NO regeneres el fixture para que pase: revisa el diff.
 * (Captura inicial: `LAZUNOX_CAPTURE_SEATBELT_BEFORE=1`; solo se usó una vez, con el código original.)
 *
 * Actualización DELIBERADA (F8-B194, endurecer lecturas): el fixture se recapturó una vez más y se revisó el diff,
 * que contiene SOLO (a) las rutas nuevas de la lista de lectura denegada del perfil (`defaultDeniedReadPaths`:
 * dotfiles de shell, `.gitconfig`, `.config`, `.claude`, `.codex`, Group Containers, apps con sesión…) y (b) la
 * variable `GIT_CONFIG_GLOBAL` (archivo global de git propio en el directorio privado: con `~/.gitconfig` denegado
 * `git` moría). Nada del lanzamiento (comando, argumentos, red, escritura, proxies, limpieza) cambió.
 *
 * Actualización DELIBERADA (F8-B197, firma de los commits): el fixture se recapturó (y se pasó por Prettier, que lo guarda así) y el diff
 * son SOLO 8 líneas: `GIT_AUTHOR_NAME`/`GIT_AUTHOR_EMAIL`/`GIT_COMMITTER_NAME`/`GIT_COMMITTER_EMAIL` («Lazunox» y
 * `lazunox@localhost.invalid`) en el `env` de los dos lanzamientos con aislamiento. Sin ellas git firmaba con el nombre completo del usuario
 * de macOS y el nombre del equipo. Comando, argumentos, perfil, red, escritura, proxies y limpieza no cambiaron.
 *
 * Actualización DELIBERADA (F8-B208, salida al propio puerto): el fixture se recapturó (y se pasó por Prettier) y el diff es SOLO la línea
 * `(allow network-outbound (remote ip "localhost:51000"))` (el `serverPort`) en los 5 perfiles con puerto del servidor. Sin ella el cliente
 * interno de los plugins del motor no alcanzaba a su propio servidor y `lazunox-subagent-guard` bloqueaba todo `task` en Tareas. Ningún
 * otro destino de red, ni escritura, comando, entorno, proxies o limpieza cambió.
 */
import { EventEmitter } from 'node:events'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { macOnly } from '../../test/platform'

interface Rec {
  spawns: Array<{ command: string; args: string[]; opts: Record<string, unknown>; profileText: string | null }>
  proxies: Array<Record<string, unknown>>
  pids: unknown[]
  kills: unknown[]
  rnd: number
  tok: number
  userData: string
  child: (EventEmitter & { exitCode: number | null; signalCode: string | null }) | null
}
const rec = vi.hoisted((): Rec => ({ spawns: [], proxies: [], pids: [], kills: [], rnd: 0, tok: 0, userData: '', child: null }))

vi.mock('electron', () => ({ app: { getPath: () => rec.userData, getAppPath: () => '/fixture/app' } }))
vi.mock('node:os', async (orig) => ({ ...(await orig<typeof import('node:os')>()), homedir: () => '/Users/fixture' }))
vi.mock('node:crypto', async (orig) => ({
  ...(await orig<typeof import('node:crypto')>()),
  // Determinista por TAMAÑO (24 contraseña, 6 perfil, 8 centinela): no depende del orden de las llamadas.
  randomBytes: (n: number) => Buffer.alloc(n, n)
}))
vi.mock('node:child_process', async (orig) => {
  const { EventEmitter: EE } = await import('node:events')
  const { readFileSync: rf } = await import('node:fs')
  return {
    ...(await orig<typeof import('node:child_process')>()),
    spawn: (command: string, args: string[], opts: Record<string, unknown>) => {
      const i = args.indexOf('-f')
      let profileText: string | null = null
      if (i >= 0) profileText = rf(args[i + 1]!, 'utf8')
      rec.spawns.push({ command, args: [...args], opts: JSON.parse(JSON.stringify(opts)), profileText })
      const child = Object.assign(new EE(), { pid: 4242, exitCode: null, signalCode: null, stdout: new EE(), stderr: new EE() })
      rec.child = child
      return child
    }
  }
})
vi.mock('../opencode/server', () => ({ resolveOpencodeAsync: async () => ({ path: '/fixture/bin/opencode' }) }))
vi.mock('../util/net', () => ({ getFreePort: async () => 51000, waitForHealth: async () => '9.9.9' }))
vi.mock('../opencode/pids', () => ({
  trackPid: (pid: unknown, label: unknown) => rec.pids.push(['track', pid, label]),
  untrackPid: (pid: unknown) => rec.pids.push(['untrack', pid]),
  killTree: (pid: unknown, sig: unknown) => {
    rec.kills.push([pid, sig])
    if (sig === 'SIGTERM' && rec.child) {
      rec.child.exitCode = 0
      rec.child.emit('exit', 0)
    }
  }
}))
vi.mock('./opencode-config', () => ({
  getOpencodeEnv: () => ({ OPENCODE_CONFIG_DIR: `${rec.userData}/opencode-config`, OPENCODE_FIXTURE: 'y' })
}))
vi.mock('../process/child-env', () => ({ minimalEnv: (e: Record<string, string>) => e }))
vi.mock('../process/disclaim', () => ({
  withDisclaim: (command: string, args: string[]) => ({
    command: '/fixture/launcher/lazunox-disclaim',
    args: [command, ...args],
    disclaimed: true
  })
}))
vi.mock('./proxy', () => {
  class EgressProxy {
    port = 52000
    constructor(o: { token: string; allowlist: () => readonly string[]; onBlocked?: unknown; onLog?: unknown }) {
      rec.proxies.push({ kind: 'egress', token: o.token, allowlist: [...o.allowlist()], onBlocked: !!o.onBlocked, onLog: !!o.onLog })
    }
    async start(): Promise<void> {
      rec.proxies.push({ kind: 'egress.start' })
    }
    async stop(): Promise<void> {
      rec.proxies.push({ kind: 'egress.stop' })
    }
  }
  let n = 0
  class CredentialProxy {
    port: number
    private token: string
    constructor(o: Record<string, unknown>) {
      this.port = 52001 + n++
      this.token = String(o.token)
      rec.proxies.push({ kind: 'cred', ...o })
    }
    baseUrl(): string {
      return `http://127.0.0.1:${this.port}/${this.token}`
    }
    async start(): Promise<void> {
      rec.proxies.push({ kind: 'cred.start', port: this.port })
    }
    async stop(): Promise<void> {
      rec.proxies.push({ kind: 'cred.stop', port: this.port })
    }
  }
  return { EgressProxy, CredentialProxy, randomToken: () => `tok${++rec.tok}` }
})

import { appAuthFile } from '../opencode/data-dir'
import { buildSandboxProfile, startTasksServer, writeSandboxProfile, type StartTasksServerOptions } from './sandbox'

const FIXTURE = join(__dirname, '__fixtures__', 'seatbelt-before.json')
const CAPTURE = process.env.LAZUNOX_CAPTURE_SEATBELT_BEFORE === '1'

let root = ''
let osTmp = ''

function norm<T>(v: T): T {
  const s = JSON.stringify(v)
    .replaceAll(root, '<ROOT>')
    .replaceAll(osTmp, '<OSTMP>')
    .replace(/[^"\s\\]*profile-[0-9a-f]{12}\.sb/g, '<PROFILE>')
  return JSON.parse(s) as T
}

function reset(): void {
  rec.spawns.length = 0
  rec.proxies.length = 0
  rec.pids.length = 0
  rec.kills.length = 0
  rec.rnd = 0
  rec.tok = 0
  rec.child = null
}

async function launch(
  name: string,
  withIso: boolean,
  build: (d: { folder: string; iso: { privateDir: string; userData: string } }) => StartTasksServerOptions
) {
  reset()
  const folder = join(root, 'work', 'proyecto')
  const iso = { privateDir: join(rec.userData, 'tasks-sandbox', '0123456789abcdef'), userData: rec.userData }
  const opts = build({ folder, iso })
  if (withIso) opts.isolation = iso
  const exits: unknown[] = []
  opts.onExit = (c) => exits.push(c)
  let error: string | null = null
  let handle: Awaited<ReturnType<typeof startTasksServer>> | null = null
  try {
    handle = await startTasksServer(folder, opts)
  } catch (e) {
    error = e instanceof Error ? e.message : String(e)
  }
  const profileFileExistsBeforeStop = rec.spawns[0]?.args.includes('-f')
    ? existsSync(rec.spawns[0]!.args[rec.spawns[0]!.args.indexOf('-f') + 1]!)
    : null
  let handleInfo: Record<string, unknown> | null = null
  let afterStop: Record<string, unknown> | null = null
  if (handle) {
    handleInfo = {
      folder: handle.folder,
      baseUrl: handle.baseUrl,
      authorization: handle.authorization,
      username: handle.username,
      sandboxed: handle.sandboxed,
      pid: handle.pid,
      version: handle.version,
      egressPort: handle.egressPort,
      deleteAllowed: handle.deleteAllowed
    }
    await handle.stop()
    const code = await handle.exited
    const profileArg = rec.spawns[0]?.args.includes('-f') ? rec.spawns[0]!.args[rec.spawns[0]!.args.indexOf('-f') + 1]! : null
    afterStop = { code, exits, profileRemoved: profileArg ? !existsSync(profileArg) : null }
    await new Promise((r) => setImmediate(r)) // los `void stop()` de proxies
  }
  return norm({
    name,
    error,
    spawns: rec.spawns,
    profileFileExistsBeforeStop,
    handleInfo,
    afterStop,
    proxies: rec.proxies,
    pids: rec.pids,
    kills: rec.kills
  })
}

async function allLaunches() {
  const authFile = appAuthFile(rec.userData)
  mkdirSync(dirname(authFile), { recursive: true })
  const out = []
  out.push(await launch('basico-sin-auth', true, () => ({})))
  writeFileSync(
    authFile,
    JSON.stringify({
      'opencode-go': { type: 'api', key: 'sk-FIXTURE-real-key' },
      'proveedor-desconocido': { type: 'api', key: 'sk-otro' }
    })
  )
  out.push(
    await launch('completo', true, ({ folder }) => ({
      corsOrigins: ['http://localhost:5173', 'lazunox://app'],
      extraEnv: { OPENCODE_CONFIG_CONTENT: JSON.stringify({ model: 'x/y', provider: { otro: { name: 'Otro' } } }), EXTRA_FLAG: '1' },
      networkAllowlist: () => ['opencode.ai', 'registry.npmjs.org'],
      onEgressBlocked: () => {},
      onEgressLog: () => {},
      allowDelete: true,
      extraFolders: [
        { path: join(root, 'extra', 'rw'), mode: 'rw' },
        { path: join(root, 'extra', 'ro'), mode: 'ro' },
        { path: join(folder, 'dentro'), mode: 'rw' }
      ],
      extraOutboundPorts: [4096, 4097]
    }))
  )
  out.push(await launch('sin-isolation', false, () => ({})))
  out.push(await launch('sin-sandbox', true, () => ({ noSandbox: true, extraEnv: { EXTRA_FLAG: '2' }, corsOrigins: ['http://x'] })))
  return out
}

function profiles() {
  const base = {
    folder: '/fixture/work/proyecto',
    privateDir: '/fixture/userData/tasks-sandbox/0123456789abcdef',
    userData: '/fixture/userData',
    readOnly: ['/fixture/userData/opencode-config'],
    home: '/Users/fixture'
  }
  const inputs: Array<[string, Parameters<typeof buildSandboxProfile>[0]]> = [
    ['base', base],
    ['red', { ...base, allowedOutboundPorts: [52000, 52001, 52000, 4096], serverPort: 51000 }],
    ['borrar', { ...base, allowDelete: true, allowedOutboundPorts: [52000], serverPort: 51000 }],
    [
      'extras',
      {
        ...base,
        allowDelete: false,
        extraFolders: [
          { path: '/fixture/otra/rw', mode: 'rw' },
          { path: '/fixture/otra/ro', mode: 'ro' },
          { path: '/fixture/work', mode: 'rw' }
        ]
      }
    ],
    [
      'extras-borrar',
      {
        ...base,
        allowDelete: true,
        extraFolders: [
          { path: '/fixture/work', mode: 'rw' },
          { path: '/fixture/work/proyecto/sub', mode: 'rw' }
        ]
      }
    ],
    ['scratch', { ...base, scratchDirs: ['/fixture/work/proyecto/a', '/fixture/work/proyecto/b'], extraWritable: ['/fixture/extra'] }],
    ['sin-userdata', { folder: base.folder, privateDir: base.privateDir, home: base.home }]
  ]
  const direct = inputs.map(([name, o]) => [name, buildSandboxProfile(o)] as const)
  // `writeSandboxProfile` (archivo temporal) con las mismas opciones de red/borrado.
  const dir = mkdtempSync(join(root, 'prof-'))
  const written = [
    ['w-sin-red', undefined],
    [
      'w-red',
      {
        allowedOutboundPorts: [52000, 52001],
        serverPort: 51000,
        allowDelete: true,
        extraFolders: [{ path: '/fixture/e/rw', mode: 'rw' as const }]
      }
    ]
  ].map(([name, net]) => {
    const f = writeSandboxProfile(
      base.folder,
      { privateDir: base.privateDir, userData: base.userData },
      '/fixture/userData/opencode-config',
      net as Parameters<typeof writeSandboxProfile>[3],
      dir
    )
    return [name as string, readFileSync(f, 'utf8')] as const
  })
  return Object.fromEntries([...direct, ...written].map(([k, v]) => [k, v.replaceAll(osTmp, '<OSTMP>')]))
}

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'lazunox-eq-')))
  osTmp = realpathSync(tmpdir())
  rec.userData = join(root, 'userData')
  mkdirSync(join(root, 'work', 'proyecto'), { recursive: true })
  mkdirSync(join(rec.userData, 'opencode-config'), { recursive: true })
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

// Seatbelt solo existe en macOS (`sandbox-exec`); el resto de plataformas no lo ejecutan.
describe.skipIf(!macOnly)('lanzamiento Seatbelt: equivalencia byte a byte con el código previo a la extracción', () => {
  it('perfiles, comando, argumentos, entorno y limpieza coinciden con el fixture capturado antes', async () => {
    const actual = { profiles: profiles(), launches: await allLaunches() }
    if (CAPTURE) {
      mkdirSync(dirname(FIXTURE), { recursive: true })
      writeFileSync(FIXTURE, JSON.stringify(actual, null, 2) + '\n')
      return
    }
    const before = JSON.parse(readFileSync(FIXTURE, 'utf8'))
    // Comparación de texto exacto de cada perfil (byte a byte) y del resto estructural.
    for (const [k, v] of Object.entries(before.profiles as Record<string, string>)) {
      expect(Buffer.from(actual.profiles[k]!, 'utf8').equals(Buffer.from(v, 'utf8')), `perfil ${k}`).toBe(true)
    }
    expect(Object.keys(actual.profiles).sort()).toEqual(Object.keys(before.profiles).sort())
    expect(JSON.stringify(actual.launches)).toBe(JSON.stringify(before.launches))
  })

  it('el fixture cubre los casos clave (sandbox, sin sandbox, sin isolation)', () => {
    if (CAPTURE) return
    const before = JSON.parse(readFileSync(FIXTURE, 'utf8'))
    const names = before.launches.map((l: { name: string }) => l.name)
    expect(names).toEqual(['basico-sin-auth', 'completo', 'sin-isolation', 'sin-sandbox'])
    const completo = before.launches[1]
    expect(completo.spawns[0].command).toBe('/fixture/launcher/lazunox-disclaim')
    expect(completo.spawns[0].args.slice(0, 2)).toEqual(['/usr/bin/sandbox-exec', '-f'])
    expect(completo.spawns[0].profileText).toContain('(deny network*)')
  })
})
