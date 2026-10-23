import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { MOTOR_APP_NAME } from '@shared/brand'
import { bundledOpencodePath } from './server'
import { installMotorApp, installedMotorCurrent, motorPaths, sourceFingerprint, type MotorRun } from './motor-app'
import { posixOnly } from '../../test/platform'

const dirs: string[] = []
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop() as string, { recursive: true, force: true })
})

/** Una «app maestra» falsa: ejecutable e Info.plist (sin firma real; el sello `CodeResources` va vacío como en el bundle real). */
function fixture(exeBody = '#!/bin/sh\necho 1.19.0\n'): { res: string; appData: string } {
  const root = mkdtempSync(join(tmpdir(), 'lzx-motor-'))
  dirs.push(root)
  const res = join(root, 'Resources')
  const app = join(res, 'opencode', MOTOR_APP_NAME)
  mkdirSync(join(app, 'Contents', 'MacOS'), { recursive: true })
  writeFileSync(join(app, 'Contents', 'MacOS', 'opencode'), exeBody)
  chmodSync(join(app, 'Contents', 'MacOS', 'opencode'), 0o755)
  writeFileSync(join(app, 'Contents', 'Info.plist'), '<plist/>')
  const appData = join(root, 'AppData')
  mkdirSync(appData)
  return { res, appData }
}

const DR = 'identifier "cl.t.lazunox.motor" and certificate leaf = H"abc123"'

interface Fake {
  /** CDHash que informa `codesign -dvvv` de la maestra; sin él simula una maestra sin firma. */
  cdhash?: string
  /** Requisito designado de la maestra; sin él simula que no hay. */
  dr?: string
  /** Hace fallar cualquier `--verify`. */
  failVerify?: boolean
  /** Hace fallar solo el primer `--verify` (la copia vieja). */
  failFirstVerify?: boolean
}

/** `ditto` simulado con una copia; `codesign` simulado. Devuelve stdout+stderr como el real. */
function fakeRun(calls: string[][], f: Fake = {}): MotorRun {
  let verifs = 0
  return (cmd, args) => {
    calls.push([cmd.split('/').pop() as string, ...args])
    if (cmd.endsWith('ditto')) {
      cpSync(args[0], args[1], { recursive: true })
      return ''
    }
    if (args[0] === '-dvvv') {
      if (!f.cdhash) throw new Error('code object is not signed at all')
      return `Identifier=cl.t.lazunox.motor\nCDHash=${f.cdhash}\n`
    }
    if (args[0] === '-d') {
      if (!f.dr) throw new Error('code object is not signed at all')
      return `Executable=x\ndesignated => ${f.dr}\n`
    }
    if (args[0] === '--verify') {
      verifs++
      if (f.failVerify || (f.failFirstVerify && verifs === 1)) throw new Error('a sealed resource is missing or invalid')
      return ''
    }
    return ''
  }
}

const verifyCalls = (calls: string[][]): string[][] => calls.filter((c) => c[1] === '--verify')

describe('Lazunox Motor.app: huella de la maestra', () => {
  it('firmada: es el CDHash (cambia aunque el tamaño del motor sea el mismo)', () => {
    const { res } = fixture()
    const src = motorPaths(res, '/x').source
    const a = sourceFingerprint(src, fakeRun([], { cdhash: 'a'.repeat(40) }))
    const b = sourceFingerprint(src, fakeRun([], { cdhash: 'b'.repeat(40) }))
    expect(a).toBe(`cd:${'a'.repeat(40)}`)
    expect(b).not.toBe(a)
  })

  it('sin firma (pruebas/desarrollo): hash del contenido del ejecutable y del Info.plist; detecta un motor del mismo tamaño', () => {
    const a = fixture('#!/bin/sh\necho AAAA\n')
    const b = fixture('#!/bin/sh\necho BBBB\n') // mismo tamaño que a
    const fa = sourceFingerprint(motorPaths(a.res, a.appData).source, fakeRun([]))
    const fb = sourceFingerprint(motorPaths(b.res, b.appData).source, fakeRun([]))
    expect(fa).toMatch(/^fs:[0-9a-f]{64}$/)
    expect(fb).not.toBe(fa)
    writeFileSync(join(motorPaths(a.res, a.appData).source, 'Contents', 'Info.plist'), '<plist>otro</plist>')
    expect(sourceFingerprint(motorPaths(a.res, a.appData).source, fakeRun([]))).not.toBe(fa)
  })

  it('sin maestra devuelve null', () => {
    const { res } = fixture()
    expect(sourceFingerprint(join(res, 'no-existe'), fakeRun([]))).toBeNull()
  })
})

describe('Lazunox Motor.app: copia externa', () => {
  it.skipIf(!posixOnly)(
    'instala, verifica la copia contra el requisito de la maestra antes de ponerla, y la segunda vez solo verifica',
    () => {
      const { res, appData } = fixture()
      const p = motorPaths(res, appData)
      const f: Fake = { cdhash: 'a'.repeat(40), dr: DR }
      const calls: string[][] = []
      expect(installedMotorCurrent(p, fakeRun([], f))).toBe(false)
      expect(installMotorApp(p, { run: fakeRun(calls, f) })).toBe('installed')
      expect(calls.map((c) => c[0])).toContain('ditto')
      const v = verifyCalls(calls)
      expect(v).toHaveLength(1)
      expect(v[0].slice(1, 4)).toEqual(['--verify', '--strict', `-R=${DR}`])
      expect(v[0][4]).toContain('.nuevo-') // se verifica ANTES de ponerla en su sitio
      expect(existsSync(p.exe)).toBe(true)
      expect(installedMotorCurrent(p, fakeRun([], f))).toBe(true)
      // Sin restos temporales.
      expect(readdirSync(p.installDir).sort()).toEqual([MOTOR_APP_NAME, 'fuente.sha256'].sort())

      calls.length = 0
      // Al día: no copia, solo verifica la firma y el requisito de la copia instalada.
      expect(installMotorApp(p, { run: fakeRun(calls, f) })).toBe('current')
      expect(calls.some((c) => c[0] === 'ditto')).toBe(false)
      expect(verifyCalls(calls)[0].slice(-2)).toEqual([`-R=${DR}`, p.app])
    }
  )

  it.skipIf(!posixOnly)('una versión nueva de la maestra (otro CDHash) reemplaza la copia', () => {
    const { res, appData } = fixture()
    const p = motorPaths(res, appData)
    installMotorApp(p, { run: fakeRun([], { cdhash: 'a'.repeat(40), dr: DR }) })
    writeFileSync(join(p.source, 'Contents', 'MacOS', 'opencode'), '#!/bin/sh\necho nueva\n')
    const nuevo: Fake = { cdhash: 'b'.repeat(40), dr: DR }
    expect(installedMotorCurrent(p, fakeRun([], nuevo))).toBe(false)
    expect(installMotorApp(p, { run: fakeRun([], nuevo) })).toBe('installed')
    expect(readFileSync(p.exe, 'utf8')).toContain('nueva')
    expect(installedMotorCurrent(p, fakeRun([], nuevo))).toBe(true)
  })

  it.skipIf(!posixOnly)('mismo tamaño y mismo contenido pero otra firma/certificado (otro CDHash): se reinstala', () => {
    const { res, appData } = fixture()
    const p = motorPaths(res, appData)
    installMotorApp(p, { run: fakeRun([], { cdhash: 'a'.repeat(40), dr: DR }) })
    const otraFirma: Fake = { cdhash: 'c'.repeat(40), dr: 'identifier "cl.t.lazunox.motor" and certificate leaf = H"zzz999"' }
    const calls: string[][] = []
    expect(installMotorApp(p, { run: fakeRun(calls, otraFirma) })).toBe('installed')
    expect(calls.some((c) => c[0] === 'ditto')).toBe(true)
  })

  it.skipIf(!posixOnly)('copia «al día» pero que no valida (alterada o de otra identidad): se reinstala desde la maestra', () => {
    const { res, appData } = fixture()
    const p = motorPaths(res, appData)
    const f: Fake = { cdhash: 'a'.repeat(40), dr: DR }
    installMotorApp(p, { run: fakeRun([], f) })
    expect(installedMotorCurrent(p, fakeRun([], f))).toBe(true)
    const calls: string[][] = []
    // La primera verificación (la copia instalada) falla; la de la copia nueva pasa.
    expect(installMotorApp(p, { run: fakeRun(calls, { ...f, failFirstVerify: true }) })).toBe('installed')
    expect(calls.filter((c) => c[0] === 'ditto')).toHaveLength(1)
    expect(verifyCalls(calls)).toHaveLength(2)
  })

  it.skipIf(!posixOnly)('si la firma de la copia nueva no valida, no la deja puesta y conserva la anterior', () => {
    const { res, appData } = fixture()
    const p = motorPaths(res, appData)
    const f: Fake = { cdhash: 'a'.repeat(40), dr: DR }
    installMotorApp(p, { run: fakeRun([], f) })
    const anterior = readFileSync(p.exe, 'utf8')
    writeFileSync(join(p.source, 'Contents', 'MacOS', 'opencode'), '#!/bin/sh\necho nueva\n')
    expect(installMotorApp(p, { run: fakeRun([], { cdhash: 'b'.repeat(40), dr: DR, failVerify: true }) })).toBe('failed')
    expect(readFileSync(p.exe, 'utf8')).toBe(anterior)
    expect(readdirSync(p.installDir).filter((n) => n.startsWith('.'))).toEqual([])
  })

  it.skipIf(!posixOnly)('borra restos de intentos anteriores que murieron a medias', () => {
    const { res, appData } = fixture()
    const p = motorPaths(res, appData)
    mkdirSync(join(p.installDir, '.nuevo-99999', MOTOR_APP_NAME), { recursive: true })
    mkdirSync(join(p.installDir, '.viejo-88888'), { recursive: true })
    expect(installMotorApp(p, { run: fakeRun([], { cdhash: 'a'.repeat(40), dr: DR }) })).toBe('installed')
    expect(readdirSync(p.installDir).filter((n) => n.startsWith('.'))).toEqual([])
  })

  it.skipIf(!posixOnly)('maestra sin firma (desarrollo): verifica sin requisito y no lanza', () => {
    const { res, appData } = fixture()
    const p = motorPaths(res, appData)
    const calls: string[][] = []
    expect(installMotorApp(p, { run: fakeRun(calls) })).toBe('installed')
    expect(verifyCalls(calls)[0].some((a) => a.startsWith('-R='))).toBe(false)
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
    const pick = (): string | null =>
      bundledOpencodePath({ isPackaged: true, resourcesPath: res, platform: 'darwin', appDataPath: appData })
    expect(pick()).toBe(nested)
    // La maestra de pruebas no está firmada: la huella es la del contenido, igual en la instalación y en la resolución de la ruta.
    installMotorApp(p, { run: fakeRun([]) })
    expect(pick()).toBe(p.exe)
    // Maestra cambiada sin reinstalar: la copia ya no es vigente, se usa la anidada.
    writeFileSync(join(p.source, 'Contents', 'MacOS', 'opencode'), '#!/bin/sh\necho otra\n')
    expect(pick()).toBe(nested)
  })
})
