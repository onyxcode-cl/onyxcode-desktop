import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { bundlePathFromExe, isUpdating, startSwap, validateSwapArgs, type SwapArgs, type SwapContext } from './swap'
import { BootMarkers, cleanupAfterBoot, readSwapResult } from './markers'
import { mkdirSync } from 'node:fs'

let tmp: string
beforeEach(() => {
  tmp = realpathSync(mkdtempSync(join(tmpdir(), 'onyx-swapts-')))
})
afterEach(() => rmSync(tmp, { recursive: true, force: true }))

function ctx(): SwapContext {
  return { userData: join(tmp, 'ud'), currentApp: '/Applications/OnyxCode.app', currentVersion: '0.3.0', pid: 4321 }
}
function good(c: SwapContext): SwapArgs {
  return {
    pid: c.pid,
    target: c.currentApp,
    staged: join(c.userData, 'update', 'staging', '0.4.0', 'extract', 'OnyxCode.app'),
    bak: '/Applications/.OnyxCode.app.bak-0.3.0',
    markerDir: join(c.userData, 'update'),
    version: '0.4.0'
  }
}

describe('bundlePathFromExe', () => {
  it('saca la .app del ejecutable', () => {
    expect(bundlePathFromExe('/Applications/OnyxCode.app/Contents/MacOS/OnyxCode')).toBe('/Applications/OnyxCode.app')
    expect(bundlePathFromExe('/Users/a/Applications/OnyxCode.app/Contents/MacOS/OnyxCode')).toBe('/Users/a/Applications/OnyxCode.app')
    expect(bundlePathFromExe('/x/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron')).toBeNull()
  })
})

describe('validateSwapArgs', () => {
  it('acepta los argumentos esperados', () => {
    const c = ctx()
    expect(validateSwapArgs(good(c), c)).toBeNull()
  })
  it.each([
    ['pid ajeno', { pid: 1234 }],
    ['pid 1', { pid: 1 }],
    ['pid no entero', { pid: 4321.5 }],
    ['target distinto de la app en ejecución', { target: '/Applications/Otra/OnyxCode.app' }],
    ['staged fuera del staging', { staged: '/tmp/x/OnyxCode.app' }],
    ['staged de otra versión', { staged: '/ud/update/staging/9.9.9/extract/OnyxCode.app' }],
    ['marcadores fuera de userData', { markerDir: '/tmp/update' }],
    ['copia en otra carpeta', { bak: '/tmp/.OnyxCode.app.bak-0.3.0' }],
    ['copia con otra versión', { bak: '/Applications/.OnyxCode.app.bak-0.0.1' }],
    ['versión no semver', { version: 'x; rm -rf /' }],
    ['ruta con ..', { staged: '/ud/update/staging/../../x/OnyxCode.app' }],
    ['ruta con salto de línea', { target: '/Applications/OnyxCode.app\nx' }],
    ['ruta con comillas', { markerDir: '/ud/up"date' }],
    ['ruta relativa', { bak: '.OnyxCode.app.bak-0.3.0' }]
  ])('rechaza %s', (_n, over) => {
    const c = ctx()
    expect(validateSwapArgs({ ...good(c), ...over }, c)).not.toBeNull()
  })
})

describe('startSwap', () => {
  it('copia el script a run/ (0700), lo lanza con /bin/sh sin shell y cierra la app', () => {
    const c = { ...ctx(), userData: join(tmp, 'ud') }
    const src = join(tmp, 'swap.sh')
    writeFileSync(src, '#!/bin/sh\nexit 0\n')
    const calls: { cmd: string; args: string[]; opts: { detached: true; stdio: 'ignore'; env: Record<string, string> } }[] = []
    let quit = 0
    let unref = 0
    const staged = good(c).staged
    const copy = startSwap(
      {
        scriptSource: src,
        ctx: c,
        quit: () => quit++,
        spawn: (cmd, args, opts) => {
          calls.push({ cmd, args, opts })
          return { unref: () => void unref++ }
        }
      },
      staged,
      '0.4.0'
    )
    expect(isUpdating()).toBe(true)
    expect(quit).toBe(1)
    expect(unref).toBe(1)
    expect(calls).toHaveLength(1)
    expect(calls[0].cmd).toBe('/bin/sh')
    expect(calls[0].args).toEqual([
      copy,
      '4321',
      '/Applications/OnyxCode.app',
      staged,
      '/Applications/.OnyxCode.app.bak-0.3.0',
      join(c.userData, 'update'),
      '0.4.0'
    ])
    expect(calls[0].opts).toMatchObject({ detached: true, stdio: 'ignore' })
    expect(copy.startsWith(join(c.userData, 'update', 'run') + '/')).toBe(true)
    expect(statSync(copy).mode & 0o777).toBe(0o700)
    expect(statSync(join(c.userData, 'update', 'run')).mode & 0o777).toBe(0o700)
    expect(readFileSync(copy, 'utf8')).toBe(readFileSync(src, 'utf8'))
    expect(Object.keys(calls[0].opts.env)).not.toContain('ELECTRON_RUN_AS_NODE')
  })

  it('con argumentos no válidos no lanza nada ni cierra la app', () => {
    const c = ctx()
    let quit = 0
    expect(() =>
      startSwap(
        { scriptSource: '/no/existe', ctx: c, quit: () => quit++, spawn: () => ({ unref: () => undefined }) },
        '/tmp/fuera/OnyxCode.app',
        '0.4.0'
      )
    ).toThrow(/no válidos/)
    expect(quit).toBe(0)
  })
})

describe('marcadores de arranque', () => {
  it('booting con el PID; boot-ok solo con ventana cargada Y confirmación del renderer', () => {
    const dir = join(tmp, 'update')
    const m = new BootMarkers(dir, '0.4.0', 777)
    m.begin()
    expect(readFileSync(join(dir, 'booting-0.4.0'), 'utf8').trim()).toBe('777')
    m.loaded()
    expect(existsSync(join(dir, 'boot-ok-0.4.0'))).toBe(false)
    m.confirmed()
    expect(existsSync(join(dir, 'boot-ok-0.4.0'))).toBe(true)
  })
  it('la confirmación puede llegar antes que la carga', () => {
    const dir = join(tmp, 'update')
    const m = new BootMarkers(dir, '0.4.0', 1)
    m.begin()
    m.confirmed()
    expect(existsSync(join(dir, 'boot-ok-0.4.0'))).toBe(false)
    m.loaded()
    expect(existsSync(join(dir, 'boot-ok-0.4.0'))).toBe(true)
  })
  it('failBoot (build de prueba) nunca escribe boot-ok', () => {
    const dir = join(tmp, 'update')
    const m = new BootMarkers(dir, '0.4.0', 1, true)
    m.begin()
    m.loaded()
    m.confirmed()
    expect(existsSync(join(dir, 'boot-ok-0.4.0'))).toBe(false)
  })
  it('readSwapResult valida la forma', () => {
    const dir = join(tmp, 'update')
    mkdirSync(dir, { recursive: true })
    expect(readSwapResult(dir)).toBeNull()
    writeFileSync(join(dir, 'result.json'), '{"version":"0.4.0","ok":false,"rolledBack":true,"error":"boot-timeout"}')
    expect(readSwapResult(dir)).toEqual({ version: '0.4.0', ok: false, rolledBack: true, error: 'boot-timeout' })
    writeFileSync(join(dir, 'result.json'), '{"version":1}')
    expect(readSwapResult(dir)).toBeNull()
    writeFileSync(join(dir, 'result.json'), 'basura')
    expect(readSwapResult(dir)).toBeNull()
  })
})

describe('cleanupAfterBoot', () => {
  function layout(): { dir: string; app: string; parent: string } {
    const parent = join(tmp, 'Applications')
    const app = join(parent, 'OnyxCode.app')
    const dir = join(tmp, 'ud', 'update')
    for (const d of [
      app,
      join(parent, '.OnyxCode.app.bak-0.3.0'),
      join(parent, '.OnyxCode.app.failed-0.4.1'),
      join(parent, 'Otra.app'),
      join(dir, 'staging', '0.4.0'),
      join(dir, 'staging', '0.5.0'),
      join(dir, 'run')
    ])
      mkdirSync(d, { recursive: true })
    writeFileSync(join(dir, 'run', 'swap.sh'), 'x')
    writeFileSync(join(dir, 'booting-0.3.0'), '1')
    writeFileSync(join(dir, 'boot-ok-0.3.0'), '1')
    return { dir, app, parent }
  }
  it('primer arranque (sin boot-ok previo): conserva la copia de seguridad', () => {
    const { dir, app, parent } = layout()
    cleanupAfterBoot({ dir, appPath: app, version: '0.4.0' })
    expect(existsSync(join(parent, '.OnyxCode.app.bak-0.3.0'))).toBe(true)
  })
  it('arranque siguiente (ya hubo boot-ok de esta versión): borra copia, fallidas, marcadores viejos, stagings antiguos y scripts', () => {
    const { dir, app, parent } = layout()
    writeFileSync(join(dir, 'boot-ok-0.4.0'), '1')
    const { removed } = cleanupAfterBoot({ dir, appPath: app, version: '0.4.0' })
    expect(removed.length).toBeGreaterThan(0)
    expect(existsSync(join(parent, '.OnyxCode.app.bak-0.3.0'))).toBe(false)
    expect(existsSync(join(parent, '.OnyxCode.app.failed-0.4.1'))).toBe(false)
    expect(existsSync(join(parent, 'Otra.app'))).toBe(true)
    expect(existsSync(app)).toBe(true)
    expect(existsSync(join(dir, 'booting-0.3.0'))).toBe(false)
    expect(existsSync(join(dir, 'boot-ok-0.4.0'))).toBe(true)
    expect(existsSync(join(dir, 'staging', '0.4.0'))).toBe(false)
    expect(existsSync(join(dir, 'staging', '0.5.0'))).toBe(true)
    expect(existsSync(join(dir, 'run', 'swap.sh'))).toBe(false)
  })
  it('sin .app (modo desarrollo) solo limpia userData', () => {
    const { dir, parent } = layout()
    writeFileSync(join(dir, 'boot-ok-0.4.0'), '1')
    cleanupAfterBoot({ dir, appPath: null, version: '0.4.0' })
    expect(existsSync(join(parent, '.OnyxCode.app.bak-0.3.0'))).toBe(true)
  })
})
