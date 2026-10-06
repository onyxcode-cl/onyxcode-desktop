/**
 * `CloudflaredProcess` con plataforma `win32` INYECTADA (sin Windows real ni red): no hay vigía `/bin/sh`, ni grupos de procesos,
 * ni `withDisclaim`; el entorno es el mínimo de Windows; los huérfanos de Windows se reconocen por su línea de comandos de CIM.
 * Nada de esto se ha probado en un Windows real (docs/REMOTO-WINDOWS.md).
 */
import { EventEmitter } from 'node:events'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let userData = ''
vi.mock('electron', () => ({ app: { getPath: () => userData, getAppPath: () => process.cwd() } }))

import { isOurCloudflared } from '../../opencode/pids'
import { CloudflaredProcess, cloudflaredArgs, cloudflaredEnv, type CloudflaredDeps } from './cloudflared'

beforeEach(() => {
  userData = mkdtempSync(join(tmpdir(), 'lazunox-cfw-'))
})
afterEach(() => {
  vi.restoreAllMocks()
  rmSync(userData, { recursive: true, force: true })
})

const WIN_BIN = 'C:\\Users\\Ana\\AppData\\Roaming\\Lazunox\\bin\\cloudflared-2026.9.3\\cloudflared.exe'
const ARGS = 'tunnel --no-autoupdate --url http://127.0.0.1:50321 --metrics 127.0.0.1:0 --loglevel info --protocol auto'

describe('cloudflaredEnv en Windows', () => {
  const base = {
    SystemRoot: 'C:\\Windows',
    TEMP: 'C:\\Temp',
    APPDATA: 'C:\\Users\\Ana\\AppData\\Roaming',
    SECRET_TOKEN: 'x',
    HTTPS_PROXY: 'http://p:1'
  }
  it('entorno mínimo: perfil privado, SystemRoot, PATH de System32, TEMP y proxies; nada más', () => {
    const env = cloudflaredEnv('C:\\h', base, {}, 'win32')
    expect(env).toEqual({
      HOME: 'C:\\h',
      USERPROFILE: 'C:\\h',
      SystemRoot: 'C:\\Windows',
      windir: 'C:\\Windows',
      ComSpec: 'C:\\Windows\\System32\\cmd.exe',
      PATH: 'C:\\Windows\\System32;C:\\Windows',
      TEMP: 'C:\\Temp',
      HTTPS_PROXY: 'http://p:1'
    })
    expect(env.APPDATA).toBeUndefined()
    expect(env.SECRET_TOKEN).toBeUndefined()
  })
  it('las claves de Windows no distinguen mayúsculas y hay SystemRoot por defecto', () => {
    expect(cloudflaredEnv('C:\\h', { SYSTEMROOT: 'D:\\Win' }, {}, 'win32').SystemRoot).toBe('D:\\Win')
    expect(cloudflaredEnv('C:\\h', {}, {}, 'win32').SystemRoot).toBe('C:\\Windows')
  })
  it('macOS no cambia: HOME, PATH de sistema y LANG', () => {
    expect(cloudflaredEnv('/h', { PATH: '/zzz', SystemRoot: 'x' }, {}, 'darwin')).toEqual({
      HOME: '/h',
      PATH: '/usr/bin:/bin:/usr/sbin:/sbin',
      LANG: 'C'
    })
  })
})

describe('isOurCloudflared con líneas de comandos de Windows', () => {
  it('reconoce el nuestro (ruta con comillas, barras invertidas y .exe)', () => {
    expect(isOurCloudflared(`"${WIN_BIN}" ${ARGS}`)).toBe(true)
    expect(isOurCloudflared(`${WIN_BIN} ${ARGS}`)).toBe(true)
  })
  it('no toca el cloudflared del usuario ni argumentos distintos', () => {
    expect(isOurCloudflared(`"C:\\Program Files (x86)\\cloudflared\\cloudflared.exe" ${ARGS}`)).toBe(false)
    expect(isOurCloudflared(`"C:\\Users\\Ana\\bin\\cloudflared-2026.9.3\\cloudflared.exe" tunnel run foo`)).toBe(false)
    expect(isOurCloudflared(`"${WIN_BIN}" tunnel --url http://127.0.0.1:1`)).toBe(false) // sin --no-autoupdate
    expect(isOurCloudflared(`"${WIN_BIN}" tunnel --no-autoupdate --url http://evil.com:1`)).toBe(false)
    expect(isOurCloudflared('"C:\\Windows\\notepad.exe" notas.txt')).toBe(false)
  })
})

function fakeChild(pid: number): EventEmitter & { pid: number; stdin: PassThrough; stdout: PassThrough; stderr: PassThrough } {
  return Object.assign(new EventEmitter(), { pid, stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough() })
}

describe('CloudflaredProcess con plataforma win32 inyectada', () => {
  it('lanza el .exe directo (sin /bin/sh ni disclaim), sin detached, oculto, con el entorno de Windows; y no manda señales negativas', async () => {
    const child = fakeChild(4242)
    const spawn = vi.fn(() => child)
    const withDisclaim = vi.fn()
    const killTree = vi.fn()
    const deps = {
      spawn,
      killTree,
      descendants: vi.fn(() => [7001]),
      trackPid: vi.fn(),
      untrackPid: vi.fn(),
      withDisclaim
    } as unknown as CloudflaredDeps
    const kill = vi.spyOn(process, 'kill').mockImplementation(() => true)
    const p = new CloudflaredProcess({ binary: WIN_BIN, homeDir: join(userData, 'home'), deps, platform: 'win32', startTimeoutMs: 2000 })
    const started = p.start(50321)
    child.stderr.write(
      '2026-10-06T00:00:00Z INF |  Your quick Tunnel has been created! Visit it at (it may take some time to be reachable):  |\n'
    )
    child.stderr.write('2026-10-06T00:00:00Z INF |  https://aaa-bbb-ccc.trycloudflare.com |\n')
    child.stderr.write('2026-10-06T00:00:01Z INF Registered tunnel connection connIndex=0\n')
    await expect(started).resolves.toEqual({ url: 'https://aaa-bbb-ccc.trycloudflare.com', host: 'aaa-bbb-ccc.trycloudflare.com' })

    expect(withDisclaim).not.toHaveBeenCalled()
    const [cmd, args, opts] = spawn.mock.calls[0] as unknown as [
      string,
      string[],
      { detached: boolean; windowsHide: boolean; env: Record<string, string> }
    ]
    expect(cmd).toBe(WIN_BIN)
    expect(args).toEqual(cloudflaredArgs(50321))
    expect(opts.detached).toBe(false)
    expect(opts.windowsHide).toBe(true)
    expect(opts.env.USERPROFILE).toBe(join(userData, 'home'))
    expect(deps.trackPid).toHaveBeenCalledWith(4242, 'cloudflared')

    p.killNow()
    expect(killTree).toHaveBeenCalledWith(4242, 'SIGKILL')
    // El descendiente conocido se mata por su PID; jamás `-pid` (en Windows no es un grupo).
    expect(kill.mock.calls.map((c) => c[0])).toEqual([7001])
    expect(deps.untrackPid).toHaveBeenCalledWith(4242)
  })
})
