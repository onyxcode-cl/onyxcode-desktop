/**
 * `CloudflaredProcess` con el `cloudflared` FALSO (nada de red real). Incluye la prueba de CERO huérfanos con procesos reales.
 */
import { execFileSync, spawn, type ChildProcess } from 'node:child_process'
import { mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { macOnly } from '../../../test/platform'

const mit = it.skipIf(!macOnly)

let userData = ''
vi.mock('electron', () => ({ app: { getPath: () => userData, getAppPath: () => process.cwd() } }))

import { isOurCloudflared, killStaleServers } from '../../opencode/pids'
import { backoffDelayMs, canRestart } from './backoff'
import {
  CloudflaredProcess,
  GUARD_SCRIPT,
  TunnelStartError,
  cloudflaredArgs,
  cloudflaredEnv,
  parseCloudflaredLine,
  redactLine,
  type StartErrorCode
} from './cloudflared'
import { realCloudflaredDeps } from './real-deps'
import { fakeValue, makeFakeBinary } from './test-fake'

const T0_STDERR = readFileSync(join(__dirname, '__fixtures__', 'cloudflared-2026.9.3.stderr.txt'), 'utf8').split('\n')

const procs: CloudflaredProcess[] = []
const extra: number[] = []
beforeEach(() => {
  userData = mkdtempSync(join(tmpdir(), 'lazunox-cf-'))
})
afterEach(async () => {
  for (const p of procs.splice(0)) await p.stop().catch(() => undefined)
  for (const pid of extra.splice(0)) {
    try {
      process.kill(pid, 'SIGKILL')
    } catch {
      /* ya muerto */
    }
  }
  rmSync(userData, { recursive: true, force: true })
})

function make(mode: string, o: { startTimeoutMs?: number; stopGraceMs?: number } = {}): { p: CloudflaredProcess; lines: string[] } {
  const lines: string[] = []
  const p = new CloudflaredProcess({
    binary: makeFakeBinary(userData, mode),
    homeDir: join(userData, 'cloudflared', 'home'),
    deps: realCloudflaredDeps,
    onLine: (l) => lines.push(l),
    startTimeoutMs: 8000,
    ...o
  })
  procs.push(p)
  return { p, lines }
}

const psAll = (): string => execFileSync('/bin/ps', ['-A', '-o', 'pid=,pgid=,command='], { encoding: 'utf8' })
/** Procesos de ESTA prueba (vigía con la ruta de su carpeta temporal) y del falso; sin la línea de comandos del propio shell de pruebas. */
const ours = (): string[] =>
  psAll()
    .split('\n')
    .filter((l) => !/\bzsh\b|vitest/.test(l) && (l.includes(userData) || l.includes('fake-cloudflared.mjs tunnel')))
const guards = (): string[] => ours().filter((l) => l.includes(userData))
const fakes = (): string[] => ours().filter((l) => l.includes('fake-cloudflared.mjs tunnel'))
const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}
async function until(cond: () => boolean, ms = 6000): Promise<void> {
  const end = Date.now() + ms
  while (!cond()) {
    if (Date.now() > end) throw new Error('until: tiempo agotado')
    await new Promise((r) => setTimeout(r, 25))
  }
}

describe('parseCloudflaredLine (formato real de 2026.9.3, capturado en T0)', () => {
  it('encuentra la URL solo en el recuadro del banner y no confunde el aviso legal', () => {
    const urls = T0_STDERR.map(parseCloudflaredLine).filter((e) => e?.kind === 'url')
    expect(urls).toEqual([{ kind: 'url', url: 'https://example-fixture-words-here.trycloudflare.com' }])
  })
  it('reconoce registro y pérdida de conexión', () => {
    expect(parseCloudflaredLine('2026-10-04T23:17:12Z INF Registered tunnel connection connIndex=0 connection=x event=0')).toEqual({
      kind: 'registered'
    })
    expect(parseCloudflaredLine('2026-10-04T23:17:12Z INF Unregistered tunnel connection connIndex=0')).toEqual({ kind: 'unregistered' })
    expect(parseCloudflaredLine('2026-10-04T23:17:12Z INF Retrying connection in up to 2s')).toEqual({ kind: 'unregistered' })
  })
  it('clasifica errores solo en líneas ERR/FTL', () => {
    expect(parseCloudflaredLine('2026-10-04T23:17:12Z ERR failed to request quick Tunnel: 429 Too Many Requests')).toEqual({
      kind: 'error',
      code: 'rate'
    })
    expect(parseCloudflaredLine('2026-10-04T23:17:12Z ERR Configuration file x.yml was empty')).toEqual({
      kind: 'error',
      code: 'config-conflict'
    })
    expect(parseCloudflaredLine('2026-10-04T23:17:12Z ERR dial tcp 1.2.3.4:7844: i/o timeout')).toEqual({
      kind: 'error',
      code: 'edge-unreachable'
    })
    // «config» en una línea INF no es un error.
    expect(parseCloudflaredLine('2026-10-04T23:17:06Z INF Cannot determine default configuration path. No file [config.yml]')).toBeNull()
  })
  it('rechaza URL con puerto, ruta, una sola palabra, http, mayúsculas o con otro dominio', () => {
    for (const bad of [
      '| https://aa-bb.trycloudflare.com:443 |',
      '| https://aa-bb.trycloudflare.com/x |',
      '| https://aa.trycloudflare.com |',
      '| http://aa-bb.trycloudflare.com |',
      '| https://AA-bb.trycloudflare.com |',
      '| https://aa-bb.trycloudflare.com.evil.com |',
      '| https://evil.com/aa-bb.trycloudflare.com |',
      '| https://www.cloudflare.com/website-terms/ |'
    ])
      expect(parseCloudflaredLine(bad)?.kind, bad).not.toBe('url')
  })
  it('la URL se quita de las líneas que se guardan', () => {
    expect(redactLine('|  https://example-fixture-words-here.trycloudflare.com  |')).not.toContain('merry')
  })
})

describe('argumentos y entorno', () => {
  it('siempre --no-autoupdate, nunca --config', () => {
    const a = cloudflaredArgs(1234)
    expect(a).toContain('--no-autoupdate')
    expect(a).not.toContain('--config')
    expect(a.join(' ')).toContain('--url http://127.0.0.1:1234')
  })
  it('entorno mínimo: HOME privado, sin variables de la app y con proxies', () => {
    const env = cloudflaredEnv(
      '/h',
      { SECRET_TOKEN: 'x', OPENCODE_SERVER_PASSWORD: 'y', HTTPS_PROXY: 'http://p:1', PATH: '/zzz' },
      {},
      'darwin'
    )
    expect(env.HOME).toBe('/h')
    expect(env.PATH).toBe('/usr/bin:/bin:/usr/sbin:/sbin')
    expect(env.HTTPS_PROXY).toBe('http://p:1')
    expect(Object.keys(env)).not.toContain('SECRET_TOKEN')
    expect(Object.keys(env)).not.toContain('OPENCODE_SERVER_PASSWORD')
  })
})

describe('backoff', () => {
  it('2, 4, 8, 16, 32, 60 s (sin azar) y tope de 6 intentos', () => {
    const r = (): number => 0.5
    expect([1, 2, 3, 4, 5, 6].map((n) => backoffDelayMs(n, { rand: r }))).toEqual([2000, 4000, 8000, 16000, 32000, 60000])
    expect(backoffDelayMs(9, { rand: r })).toBe(60000)
    expect(canRestart(5)).toBe(true)
    expect(canRestart(6)).toBe(false)
  })
  it('con azar siempre queda entre 2 y 60 s; rate empieza en 60 s', () => {
    for (const rand of [0, 0.999]) for (let n = 1; n <= 8; n++) expect(backoffDelayMs(n, { rand: () => rand })).toBeGreaterThanOrEqual(2000)
    for (const rand of [0, 0.999]) for (let n = 1; n <= 8; n++) expect(backoffDelayMs(n, { rand: () => rand })).toBeLessThanOrEqual(60000)
    expect(backoffDelayMs(1, { rate: true })).toBe(60000)
  })
})

describe('isOurCloudflared', () => {
  const bin = '/Users/x/Library/Application Support/Lazunox/bin/cloudflared-2026.9.3/cloudflared'
  const args = 'tunnel --no-autoupdate --url http://127.0.0.1:50321 --metrics 127.0.0.1:0 --loglevel info --protocol auto'
  it('reconoce el binario y el vigía', () => {
    expect(isOurCloudflared(`${bin} ${args}`)).toBe(true)
    expect(isOurCloudflared(`/bin/sh -c ${GUARD_SCRIPT} sh ${bin} ${args}`)).toBe(true)
  })
  it('no toca un cloudflared del usuario ni otro programa', () => {
    expect(isOurCloudflared(`/opt/homebrew/bin/cloudflared ${args}`)).toBe(false)
    expect(isOurCloudflared(`/Users/x/bin/cloudflared-2026.9.3/cloudflared tunnel run foo`)).toBe(false)
    expect(isOurCloudflared(`${bin} tunnel --url http://127.0.0.1:1`)).toBe(false) // sin --no-autoupdate
    expect(isOurCloudflared('/usr/bin/vim notas.txt')).toBe(false)
    expect(isOurCloudflared(`${bin} tunnel --no-autoupdate --url http://evil.com:1`)).toBe(false)
  })
})

describe('CloudflaredProcess con el cloudflared falso', { timeout: 20_000 }, () => {
  mit('arranca, entrega la URL y registra el pid; stop() lo limpia todo', async () => {
    const { p, lines } = make('ok')
    const r = await p.start(4321)
    expect(r.url).toMatch(/^https:\/\/[a-z]+(-[a-z]+){3}\.trycloudflare\.com$/)
    expect(r.host).toBe(new URL(r.url).host)
    expect(p.state()).toBe('online')
    // Argumentos y entorno que de verdad recibió el binario.
    const argv = JSON.parse(fakeValue(lines, 'FAKE_ARGV') as string) as string[]
    expect(argv).toContain('--no-autoupdate')
    expect(argv).not.toContain('--config')
    expect(fakeValue(lines, 'FAKE_HOME')).toBe(join(userData, 'cloudflared', 'home'))
    // Corre en la carpeta de su HOME privado, no en la de la app (bajo ~/Documents el vigía sin TCC protestaba con «getcwd»).
    expect(realpathSync(fakeValue(lines, 'FAKE_CWD') as string)).toBe(realpathSync(join(userData, 'cloudflared', 'home')))
    expect(JSON.parse(readFileSync(join(userData, 'pids.json'), 'utf8')).map((e: { kind: string }) => e.kind)).toEqual(['cloudflared'])
    // Ni la URL ni nada sensible en el búfer guardado.
    expect(p.recentLines().join('\n')).not.toContain(new URL(r.url).host)
    const pid = p.pid() as number
    await p.stop()
    expect(alive(pid)).toBe(false)
    expect(guards()).toEqual([])
    expect(JSON.parse(readFileSync(join(userData, 'pids.json'), 'utf8'))).toEqual([])
  })

  mit('no hay URL → timeout y el proceso muere', async () => {
    const { p } = make('no-url', { startTimeoutMs: 600 })
    await expect(p.start(1)).rejects.toMatchObject({ code: 'timeout' })
    const pid = p.pid() as number
    await until(() => !alive(pid), 6000)
  })

  mit('URL tardía pero dentro del plazo', async () => {
    const { p } = make('slow-url:700')
    const t = Date.now()
    await p.start(1)
    expect(Date.now() - t).toBeGreaterThanOrEqual(600)
  })

  mit('sin «Registered» no se da por listo (timeout)', async () => {
    const { p } = make('no-register', { startTimeoutMs: 700 })
    await expect(p.start(1)).rejects.toMatchObject({ code: 'timeout' })
  })

  for (const c of ['rate-429:rate', 'config-conflict:config-conflict', 'edge-down:edge-unreachable']) {
    const [mode, code] = c.split(':')
    mit(`error ${c}`, async () => {
      const { p } = make(mode)
      await expect(p.start(1)).rejects.toMatchObject({ code })
    })
  }

  mit('URL mal formada (con puerto) → bad-url y se mata', async () => {
    const { p } = make('bad-url')
    await expect(p.start(1)).rejects.toMatchObject({ code: 'bad-url' })
    const pid = p.pid() as number
    await until(() => !alive(pid), 6000)
  })

  mit('una segunda URL distinta con el túnel en línea → onExit bad-url y muere', async () => {
    const { p } = make('two-urls')
    const exits: StartErrorCode[] = []
    p.onExit((e) => exits.push(e.error))
    await p.start(1)
    await until(() => exits.length > 0)
    expect(exits).toEqual(['bad-url'])
    expect(p.state()).toBe('exited')
  })

  mit('caída a mitad: onExit avisa y no queda nada vivo', async () => {
    const { p } = make('exit-after:300')
    const exits: StartErrorCode[] = []
    p.onExit((e) => exits.push(e.error))
    await p.start(1)
    const pid = p.pid() as number
    await until(() => exits.length > 0)
    expect(p.state()).toBe('exited')
    await until(() => !alive(pid))
  })

  mit('pérdida y recuperación de la conexión registrada → connecting y online', async () => {
    const { p } = make('unregister:150')
    const seen: string[] = []
    p.onState((s) => seen.push(s))
    await p.start(1)
    await until(() => seen.includes('connecting') && seen.filter((s) => s === 'online').length >= 1 && p.state() === 'online')
    expect(seen).toContain('connecting')
  })

  mit('salida basura y líneas larguísimas no rompen el análisis', async () => {
    const { p } = make('garbage')
    const r = await p.start(1)
    expect(r.url).toMatch(/\.trycloudflare\.com$/)
  })

  mit(
    'no responde a SIGTERM: stop() lo remata con SIGKILL a los ~3 s',
    async () => {
      const { p, lines } = make('ignore-sigterm', { stopGraceMs: 800 })
      await p.start(1)
      const pid = p.pid() as number
      await p.stop()
      expect(alive(pid)).toBe(false)
      // El mensaje del falso llega por su salida estándar: en un runner lento puede tardar un instante tras stop().
      await until(() => lines.join('\n').includes('SIGTERM ignorado'), 3000)
      expect(lines.join('\n')).toContain('SIGTERM ignorado')
      expect(guards()).toEqual([])
    },
    { retry: 2 }
  )

  mit('nieto en otro grupo: stop() también lo mata', async () => {
    const { p, lines } = make('spawn-grandchild')
    await p.start(1)
    const g = Number(fakeValue(lines, 'FAKE_GRANDCHILD_PID'))
    extra.push(g)
    expect(alive(g)).toBe(true)
    await p.stop()
    await until(() => !alive(g), 4000)
  })

  mit('killNow() síncrono mata proceso, vigía y nieto', async () => {
    const { p, lines } = make('spawn-grandchild')
    await p.start(1)
    const pid = p.pid() as number
    const g = Number(fakeValue(lines, 'FAKE_GRANDCHILD_PID'))
    extra.push(g)
    p.killNow()
    await until(() => !alive(pid) && !alive(g), 4000)
  })

  mit('un binario que muere solo (kill externo a cloudflared) se detecta al instante por el cierre de stderr', async () => {
    const { p, lines } = make('ok')
    const exits: StartErrorCode[] = []
    p.onExit((e) => exits.push(e.error))
    await p.start(1)
    // El falso se ejecuta con `exec node`, así que el hijo del vigía es el propio node.
    const mine = fakes().filter((l) => Number(l.trim().split(/\s+/)[1]) === p.pid())
    expect(mine).toHaveLength(1)
    const pid = Number(mine[0].trim().split(/\s+/)[0])
    expect(pid).toBeGreaterThan(1)
    expect(lines.length).toBeGreaterThan(0)
    process.kill(pid, 'SIGKILL')
    await until(() => exits.length > 0, 4000)
    expect(exits[0]).toMatch(/^exited:\d+$/)
    await until(() => guards().length === 0, 4000)
  })

  mit('start() dos veces seguidas falla', async () => {
    const { p } = make('ok')
    await p.start(1)
    await expect(p.start(1)).rejects.toThrow('already-started')
  })

  it('TunnelStartError lleva el código', () => {
    expect(new TunnelStartError('rate').code).toBe('rate')
  })
})

describe('CERO huérfanos', { timeout: 20_000 }, () => {
  /** Padre de prueba (proceso aparte) que lanza el vigía EXACTO (`GUARD_SCRIPT`) contra el falso y luego se queda esperando. */
  function parent(bin: string, port: number): ChildProcess {
    const code = `
      const { spawn } = require('node:child_process')
      const c = spawn('/bin/sh', ['-c', process.argv[1], 'sh', process.argv[2], 'tunnel', '--no-autoupdate', '--url', 'http://127.0.0.1:' + process.argv[3]],
        { detached: true, stdio: ['pipe', 'pipe', 'pipe'] })
      c.stderr.on('data', (d) => process.stdout.write(d))
      setInterval(() => {}, 1000)
    `
    return spawn(process.execPath, ['-e', code, GUARD_SCRIPT, bin, String(port)], { stdio: ['ignore', 'pipe', 'inherit'] })
  }

  mit('SIGKILL al proceso padre: en ≤ 3 s no queda ni el falso ni su vigía ni su nieto', async () => {
    const bin = makeFakeBinary(userData, 'spawn-grandchild')
    // Puerto propio: distingue ESTE falso de los que lanzan otras pruebas en paralelo.
    const port = 41000 + Math.floor(Math.random() * 20000)
    const par = parent(bin, port)
    const mine = (): string[] => fakes().filter((l) => new RegExp(`--url http://127\\.0\\.0\\.1:${port}(\\s|$)`).test(l))
    let out = ''
    par.stdout?.on('data', (d) => (out += String(d)))
    await until(() => out.includes('FAKE_GRANDCHILD_PID=') && out.includes('Initial protocol'))
    const g = Number(/FAKE_GRANDCHILD_PID=(\d+)/.exec(out)?.[1])
    extra.push(g)
    expect(guards().length).toBeGreaterThan(0)
    expect(mine().length).toBeGreaterThan(0)
    par.kill('SIGKILL')
    // El nieto vive en otro grupo y no lo mata el vigía (solo a su hijo): lo barre `killStaleServers`/`killTree` del lado de la app. Aquí
    // se comprueba la garantía del vigía: el binario y el propio vigía desaparecen.
    await until(() => guards().length === 0 && mine().length === 0, 4000)
  })

  mit('killStaleServers limpia una entrada cloudflared viva y no toca un PID reciclado con otro comando', async () => {
    const { p } = make('ok')
    await p.start(1)
    const pid = p.pid() as number
    // Simula una app que murió sin limpiar: el pids.json conserva la entrada de un propietario muerto.
    const file = join(userData, 'pids.json')
    const list = JSON.parse(readFileSync(file, 'utf8')) as Array<{ pid: number; owner?: number }>
    expect(list.map((e) => e.pid)).toContain(pid)
    // Un PID «reciclado»: un proceso cualquiera con otro comando, registrado como cloudflared.
    const other = spawn('/bin/sleep', ['60'], { detached: true, stdio: 'ignore' })
    extra.push(other.pid as number)
    const entries = [
      { pid, kind: 'cloudflared', startedAt: Date.now(), owner: 999999 },
      { pid: other.pid, kind: 'cloudflared', startedAt: Date.now(), owner: 999999 }
    ]
    const { writeFileSync } = await import('node:fs')
    writeFileSync(file, JSON.stringify(entries))
    const killed = killStaleServers()
    expect(killed).toBe(1)
    await until(() => !alive(pid), 4000)
    expect(alive(other.pid as number)).toBe(true)
    other.kill('SIGKILL')
  })
})
