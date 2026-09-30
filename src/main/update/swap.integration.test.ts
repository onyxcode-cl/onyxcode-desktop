// Integración de resources/updater/swap.sh con «apps» de juguete (script sh + firma ad-hoc) bajo $TMPDIR.
// Modo ONYXCODE_SWAP_TEST_NO_OPEN: `open` se sustituye por ejecutar el binario de juguete. Nunca toca apps reales.
import { spawn, spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const SCRIPT = resolve(__dirname, '../../../resources/updater/swap.sh')
const TOY = `#!/bin/sh
APP=$(cd "$(dirname "$0")/../.." && pwd)
VER=$(cat "$APP/Contents/Resources/version")
D="$ONYXCODE_SWAP_TEST_DIR"
: > "$D/started-$VER"
echo $$ > "$D/booting-$VER"
[ -f "$APP/Contents/Resources/crash-boot" ] && exit 3
if [ -f "$APP/Contents/Resources/fail-boot" ]; then
  while :; do sleep 1; done
fi
echo $$ > "$D/boot-ok-$VER"
`

let root: string
const pids: number[] = []
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'onyx-swap-'))
})
afterEach(() => {
  for (const p of pids.splice(0)) {
    try {
      process.kill(p, 'SIGKILL')
    } catch {
      /* ya terminó */
    }
  }
  rmSync(root, { recursive: true, force: true })
})

function toyApp(dir: string, version: string, flags: string[] = []): string {
  const app = join(dir, 'OnyxCode.app')
  mkdirSync(join(app, 'Contents', 'MacOS'), { recursive: true })
  mkdirSync(join(app, 'Contents', 'Resources'), { recursive: true })
  writeFileSync(join(app, 'Contents', 'MacOS', 'toy'), TOY)
  chmodSync(join(app, 'Contents', 'MacOS', 'toy'), 0o755)
  writeFileSync(join(app, 'Contents', 'Resources', 'version'), version)
  writeFileSync(
    join(app, 'Contents', 'Info.plist'),
    `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>CFBundleExecutable</key><string>toy</string><key>CFBundleIdentifier</key><string>test.onyx.toy</string><key>CFBundleShortVersionString</key><string>${version}</string></dict></plist>`
  )
  for (const f of flags) writeFileSync(join(app, 'Contents', 'Resources', f), '')
  const sig = spawnSync('/usr/bin/codesign', ['--force', '--sign', '-', app], { encoding: 'utf8' })
  expect(sig.status, sig.stderr).toBe(0)
  return app
}

interface Setup {
  target: string
  staged: string
  bak: string
  dir: string
  inst: string
}
function setup(newFlags: string[] = []): Setup {
  const inst = join(root, 'Applications')
  const dir = join(root, 'userData', 'update')
  mkdirSync(dir, { recursive: true })
  const target = toyApp(inst, '1.0.0')
  const stagedDir = join(dir, 'staging', '2.0.0', 'extract')
  const staged = toyApp(stagedDir, '2.0.0', newFlags)
  return { target, staged, bak: join(inst, '.OnyxCode.app.bak-1.0.0'), dir, inst }
}

function runSwap(
  s: Setup,
  pid: number,
  env: Record<string, string> = {},
  over: Partial<Record<'target' | 'staged' | 'bak' | 'dir', string>> = {}
): ReturnType<typeof spawnSync> {
  return spawnSync(
    '/bin/sh',
    [SCRIPT, String(pid), over.target ?? s.target, over.staged ?? s.staged, over.bak ?? s.bak, over.dir ?? s.dir, '2.0.0'],
    {
      encoding: 'utf8',
      env: {
        PATH: '/usr/bin:/bin',
        TMPDIR: tmpdir(),
        ONYXCODE_SWAP_TEST_NO_OPEN: '1',
        ONYXCODE_SWAP_WAIT_PID: '5',
        ONYXCODE_SWAP_WAIT_BOOT: '4',
        ...env
      },
      timeout: 60_000
    }
  )
}
const version = (app: string): string => readFileSync(join(app, 'Contents', 'Resources', 'version'), 'utf8')
const result = (s: Setup): Record<string, unknown> =>
  JSON.parse(readFileSync(join(s.dir, 'result.json'), 'utf8')) as Record<string, unknown>
/** PID de un proceso que termina en 0,3 s y no es hijo de este (un zombi hijo seguiría «vivo» mientras spawnSync bloquea el bucle). */
const deadPid = (): number => {
  const r = spawnSync('/bin/sh', ['-c', 'sleep 0.3 >/dev/null 2>&1 & echo $!'], { encoding: 'utf8' })
  const pid = Number(r.stdout.trim())
  pids.push(pid)
  return pid
}

describe('swap.sh', () => {
  it('reemplazo correcto: copia de seguridad, nueva en su sitio, boot-ok y result ok', () => {
    const s = setup()
    const r = runSwap(s, deadPid())
    expect(r.status, String(r.stderr)).toBe(0)
    expect(version(s.target)).toBe('2.0.0')
    expect(version(s.bak)).toBe('1.0.0')
    expect(existsSync(s.staged)).toBe(false)
    expect(existsSync(join(s.dir, 'boot-ok-2.0.0'))).toBe(true)
    expect(result(s)).toEqual({ version: '2.0.0', ok: true, rolledBack: false, error: '' })
    expect(spawnSync('/usr/bin/codesign', ['--verify', '--strict', s.target]).status).toBe(0)
  })

  it('rollback si la nueva no confirma el arranque: mata su PID, aparta la fallida y reabre la vieja', async () => {
    const s = setup(['fail-boot'])
    const r = runSwap(s, deadPid(), { ONYXCODE_SWAP_WAIT_BOOT: '3' })
    expect(r.status).toBe(1)
    expect(version(s.target)).toBe('1.0.0')
    expect(version(join(s.inst, '.OnyxCode.app.failed-2.0.0'))).toBe('2.0.0')
    expect(existsSync(s.bak)).toBe(false)
    expect(existsSync(join(s.dir, 'boot-ok-2.0.0'))).toBe(false)
    expect(result(s)).toEqual({ version: '2.0.0', ok: false, rolledBack: true, error: 'boot-timeout' })
    for (let i = 0; i < 40 && !existsSync(join(s.dir, 'started-1.0.0')); i++) await new Promise((ok) => setTimeout(ok, 100))
    expect(existsSync(join(s.dir, 'started-1.0.0'))).toBe(true) // reabrió la antigua
    const newPid = Number(readFileSync(join(s.dir, 'booting-2.0.0'), 'utf8').trim())
    pids.push(newPid)
    expect(() => process.kill(newPid, 0)).toThrow() // la nueva murió
  }, 30_000)

  it('rollback rápido si la nueva se cae nada más arrancar', () => {
    const s = setup(['crash-boot'])
    const t0 = Date.now()
    const r = runSwap(s, deadPid(), { ONYXCODE_SWAP_WAIT_BOOT: '20' })
    expect(r.status).toBe(1)
    expect(Date.now() - t0).toBeLessThan(15_000)
    expect(version(s.target)).toBe('1.0.0')
    expect(result(s)).toMatchObject({ ok: false, rolledBack: true })
  }, 30_000)

  it('PID que no muere: aborta sin tocar nada', () => {
    const s = setup()
    const sleeper = spawn('/bin/sleep', ['30'])
    pids.push(sleeper.pid as number)
    const r = runSwap(s, sleeper.pid as number, { ONYXCODE_SWAP_WAIT_PID: '1' })
    expect(r.status).toBe(1)
    expect(version(s.target)).toBe('1.0.0')
    expect(existsSync(s.staged)).toBe(true)
    expect(existsSync(s.bak)).toBe(false)
    expect(result(s)).toEqual({ version: '2.0.0', ok: false, rolledBack: false, error: 'pid-timeout' })
  }, 30_000)

  it('rechaza argumentos peligrosos sin tocar nada', () => {
    const s = setup()
    const pid = deadPid()
    const cases: Array<[string, Partial<Record<'target' | 'staged' | 'bak' | 'dir', string>>]> = [
      ['ruta relativa', { staged: 'relativa/OnyxCode.app' }],
      ['con ..', { staged: `${s.dir}/../x/OnyxCode.app` }],
      ['con comillas', { dir: `${s.dir}"x` }],
      ['copia fuera de la carpeta del destino', { bak: join(root, '.OnyxCode.app.bak-1.0.0') }],
      ['destino que no es OnyxCode.app', { target: join(s.inst, 'Otra.app') }]
    ]
    for (const [name, over] of cases) {
      const r = runSwap(s, pid, {}, over)
      expect(r.status, name).toBe(64)
    }
    expect(version(s.target)).toBe('1.0.0')
    expect(existsSync(s.staged)).toBe(true)
  })

  it('el modo de prueba se niega fuera de $TMPDIR', () => {
    const s = setup()
    const r = runSwap(s, deadPid(), { TMPDIR: '/nonexistent-tmp' })
    expect(r.status).toBe(64)
    expect(version(s.target)).toBe('1.0.0')
  })

  it('número de argumentos incorrecto', () => {
    const r = spawnSync('/bin/sh', [SCRIPT, '1'], { encoding: 'utf8' })
    expect(r.status).toBe(64)
  })
})
