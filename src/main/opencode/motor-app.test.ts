import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { MOTOR_APP_NAME } from '@shared/brand'
import { bundledOpencodePath } from './server'
import { installMotorApp, installedMotorCurrent, motorPaths, sourceFingerprint } from './motor-app'
import { posixOnly } from '../../test/platform'

const dirs: string[] = []
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop() as string, { recursive: true, force: true })
})

/** Una «app maestra» falsa: ejecutable, sello (CodeResources) e Info.plist. */
function fixture(exeBody = '#!/bin/sh\necho 1.19.0\n', seal = 'sello-1'): { res: string; appData: string } {
  const root = mkdtempSync(join(tmpdir(), 'lzx-motor-'))
  dirs.push(root)
  const res = join(root, 'Resources')
  const app = join(res, 'opencode', MOTOR_APP_NAME)
  mkdirSync(join(app, 'Contents', 'MacOS'), { recursive: true })
  mkdirSync(join(app, 'Contents', '_CodeSignature'), { recursive: true })
  writeFileSync(join(app, 'Contents', 'MacOS', 'opencode'), exeBody)
  chmodSync(join(app, 'Contents', 'MacOS', 'opencode'), 0o755)
  writeFileSync(join(app, 'Contents', '_CodeSignature', 'CodeResources'), seal)
  writeFileSync(join(app, 'Contents', 'Info.plist'), '<plist/>')
  const appData = join(root, 'AppData')
  mkdirSync(appData)
  return { res, appData }
}

/** `ditto` simulado con una copia; `codesign` simulado (se anota la llamada). */
function fakeRun(calls: string[][], failCodesign = false) {
  return (cmd: string, args: string[]): void => {
    calls.push([cmd, ...args])
    if (cmd.endsWith('ditto')) cpSync(args[0], args[1], { recursive: true })
    else if (cmd.endsWith('codesign') && failCodesign) throw new Error('firma inválida')
  }
}

describe('Lazunox Motor.app: copia externa', () => {
  it('la huella cambia con el sello o con el ejecutable, y es null sin maestra', () => {
    const a = fixture()
    const b = fixture('#!/bin/sh\necho otro\n')
    const c = fixture('#!/bin/sh\necho 1.19.0\n', 'sello-2')
    const fa = sourceFingerprint(motorPaths(a.res, a.appData).source)
    expect(fa).toMatch(/^[0-9a-f]{64}$/)
    expect(fa).not.toBe(sourceFingerprint(motorPaths(b.res, b.appData).source))
    expect(fa).not.toBe(sourceFingerprint(motorPaths(c.res, c.appData).source))
    expect(sourceFingerprint(join(a.res, 'no-existe'))).toBeNull()
  })

  it.skipIf(!posixOnly)('instala, verifica la firma antes de poner la copia, y la segunda vez no hace nada', () => {
    const { res, appData } = fixture()
    const p = motorPaths(res, appData)
    const calls: string[][] = []
    expect(installedMotorCurrent(p)).toBe(false)
    expect(installMotorApp(p, { run: fakeRun(calls) })).toBe('installed')
    expect(calls.map((c) => c[0].split('/').pop())).toEqual(['ditto', 'codesign'])
    expect(calls[1].slice(1, 3)).toEqual(['--verify', '--strict'])
    expect(existsSync(p.exe)).toBe(true)
    expect(installedMotorCurrent(p)).toBe(true)
    // La carpeta no deja restos temporales.
    expect(readdirSync(p.installDir).sort()).toEqual([MOTOR_APP_NAME, 'fuente.sha256'].sort())
    calls.length = 0
    expect(installMotorApp(p, { run: fakeRun(calls) })).toBe('current')
    expect(calls).toEqual([])
  })

  it.skipIf(!posixOnly)('una versión nueva de la maestra reemplaza la copia (la anterior deja de ser vigente)', () => {
    const { res, appData } = fixture()
    const p = motorPaths(res, appData)
    installMotorApp(p, { run: fakeRun([]) })
    writeFileSync(join(p.source, 'Contents', '_CodeSignature', 'CodeResources'), 'sello-nuevo')
    writeFileSync(p.source + '/Contents/MacOS/opencode', '#!/bin/sh\necho nueva\n')
    expect(installedMotorCurrent(p)).toBe(false)
    expect(installMotorApp(p, { run: fakeRun([]) })).toBe('installed')
    expect(readFileSync(p.exe, 'utf8')).toContain('nueva')
    expect(installedMotorCurrent(p)).toBe(true)
  })

  it.skipIf(!posixOnly)('si la firma de la copia no valida, no la deja puesta y conserva la anterior', () => {
    const { res, appData } = fixture()
    const p = motorPaths(res, appData)
    installMotorApp(p, { run: fakeRun([]) })
    const anterior = readFileSync(p.exe, 'utf8')
    writeFileSync(join(p.source, 'Contents', '_CodeSignature', 'CodeResources'), 'sello-nuevo')
    expect(installMotorApp(p, { run: fakeRun([], true) })).toBe('failed')
    expect(readFileSync(p.exe, 'utf8')).toBe(anterior)
    expect(installedMotorCurrent(p)).toBe(false) // desactualizada: el llamador usa la maestra anidada
    expect(readdirSync(p.installDir).filter((n) => n.startsWith('.'))).toEqual([])
  })

  it('sin maestra devuelve no-source y nunca lanza', () => {
    const root = mkdtempSync(join(tmpdir(), 'lzx-motor-'))
    dirs.push(root)
    expect(installMotorApp(motorPaths(join(root, 'R'), join(root, 'A')), { run: fakeRun([]) })).toBe('no-source')
  })

  it.skipIf(!posixOnly)('bundledOpencodePath: copia externa vigente > maestra anidada > nada', () => {
    const { res, appData } = fixture()
    const p = motorPaths(res, appData)
    const nested = join(p.source, 'Contents', 'MacOS', 'opencode')
    const pick = (): string | null => bundledOpencodePath({ isPackaged: true, resourcesPath: res, platform: 'darwin', appDataPath: appData })
    expect(pick()).toBe(nested)
    installMotorApp(p, { run: fakeRun([]) })
    expect(pick()).toBe(p.exe)
    // Maestra cambiada sin reinstalar: la copia ya no es vigente, se usa la anidada.
    writeFileSync(join(p.source, 'Contents', '_CodeSignature', 'CodeResources'), 'otro')
    expect(pick()).toBe(nested)
  })
})
