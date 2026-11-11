/**
 * Comprobaciones de enlaces del proceso principal (`no-follow.ts`, `private-dir.ts`): nunca se escribe, lee ni crea carpetas a través de
 * un enlace simbólico que una tarea haya dejado en su carpeta privada o en su carpeta de trabajo. Enlaces simbólicos sin privilegios:
 * solo macOS/Linux (en Windows crear un enlace pide permisos de administrador).
 */
import {
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { t } from '@shared/i18n'
import { posixOnly } from '../../test/platform'
import { chmodDirNoFollow, ensureRealDir, LinkRefusedError, readFileNoFollow, writeFileNoFollow } from './no-follow'
import { ENGINE_GITIGNORE, ensureTaskPrivateDir } from './private-dir'

let root: string
let outside: string
beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'lzx-nofollow-')))
  outside = join(root, 'fuera')
  mkdirSync(outside)
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

describe.skipIf(!posixOnly)('ensureRealDir', () => {
  it('crea los tramos que faltan y devuelve la ruta real', () => {
    const base = join(root, 'b')
    mkdirSync(base)
    expect(ensureRealDir(base, join(base, 'x', 'y'), { create: true })).toBe(join(base, 'x', 'y'))
    expect(lstatSync(join(base, 'x', 'y')).isDirectory()).toBe(true)
  })
  it('sin `replace`, un enlace en cualquier tramo lanza y no crea nada en el destino', () => {
    const base = join(root, 'b')
    mkdirSync(base)
    symlinkSync(outside, join(base, 'x'))
    expect(() => ensureRealDir(base, join(base, 'x', 'y'), { create: true })).toThrow(LinkRefusedError)
    expect(readdirSync(outside)).toEqual([])
  })
  it('con `replace`, borra EL ENLACE (no su destino) y crea una carpeta real', () => {
    const base = join(root, 'b')
    mkdirSync(base)
    writeFileSync(join(outside, 'dato'), 'x')
    symlinkSync(outside, join(base, 'x'))
    const seen: string[] = []
    ensureRealDir(base, join(base, 'x', 'y'), { create: true, replace: true, onReplaced: (p) => seen.push(p) })
    expect(lstatSync(join(base, 'x')).isSymbolicLink()).toBe(false)
    expect(readFileSync(join(outside, 'dato'), 'utf8')).toBe('x')
    expect(readdirSync(outside)).toEqual(['dato'])
    expect(seen).toEqual([join(base, 'x')])
  })
  it('con `replace`, un archivo suelto en lugar de la carpeta se cambia por una carpeta', () => {
    const base = join(root, 'b')
    mkdirSync(base)
    writeFileSync(join(base, 'x'), 'archivo')
    ensureRealDir(base, join(base, 'x'), { create: true, replace: true })
    expect(lstatSync(join(base, 'x')).isDirectory()).toBe(true)
  })
  it('sin `create`, un tramo que falta lanza', () => {
    const base = join(root, 'b')
    mkdirSync(base)
    expect(() => ensureRealDir(base, join(base, 'x'))).toThrow(LinkRefusedError)
  })
  it('una ruta fuera de la base (o la base misma) lanza', () => {
    const base = join(root, 'b')
    mkdirSync(base)
    expect(() => ensureRealDir(base, join(root, 'otra'), { create: true })).toThrow(LinkRefusedError)
    expect(() => ensureRealDir(base, join(base, '..', 'otra'), { create: true })).toThrow(LinkRefusedError)
    expect(() => ensureRealDir(base, base, { create: true })).toThrow(LinkRefusedError)
  })
  it('la base puede ser un enlace (es de confianza): se ancla en su ruta real', () => {
    const real = join(root, 'real')
    mkdirSync(real)
    symlinkSync(real, join(root, 'alias'))
    expect(ensureRealDir(join(root, 'alias'), join(root, 'alias', 'x'), { create: true })).toBe(join(real, 'x'))
  })
})

describe.skipIf(!posixOnly)('writeFileNoFollow / readFileNoFollow / chmodDirNoFollow', () => {
  it('escribe y lee un archivo normal, con el modo pedido', () => {
    const f = join(root, 'a.txt')
    writeFileNoFollow(f, 'hola', { mode: 0o755 })
    expect(readFileSync(f, 'utf8')).toBe('hola')
    expect(statSync(f).mode & 0o777).toBe(0o755)
    expect(readFileNoFollow(f)?.content.toString()).toBe('hola')
    writeFileNoFollow(f, 'adios')
    expect(readFileSync(f, 'utf8')).toBe('adios')
  })
  it('un enlace en el destino: sin `replace` lanza y el destino queda intacto', () => {
    const victim = join(outside, 'v.txt')
    writeFileSync(victim, 'ORIGINAL')
    symlinkSync(victim, join(root, 'a.txt'))
    expect(() => writeFileNoFollow(join(root, 'a.txt'), 'x')).toThrow(LinkRefusedError)
    expect(readFileSync(victim, 'utf8')).toBe('ORIGINAL')
  })
  it('un enlace roto (a un archivo que no existe fuera): tampoco se crea el destino', () => {
    const victim = join(outside, 'nuevo.plist')
    symlinkSync(victim, join(root, 'a.txt'))
    expect(() => writeFileNoFollow(join(root, 'a.txt'), 'x')).toThrow(LinkRefusedError)
    expect(existsSync(victim)).toBe(false)
  })
  it('con `replace`, se quita el enlace y se escribe un archivo normal nuevo; el destino queda intacto', () => {
    const victim = join(outside, 'v.txt')
    writeFileSync(victim, 'ORIGINAL')
    symlinkSync(victim, join(root, 'a.txt'))
    writeFileNoFollow(join(root, 'a.txt'), 'nuevo', { replace: true })
    expect(lstatSync(join(root, 'a.txt')).isSymbolicLink()).toBe(false)
    expect(readFileSync(join(root, 'a.txt'), 'utf8')).toBe('nuevo')
    expect(readFileSync(victim, 'utf8')).toBe('ORIGINAL')
  })
  it('un enlace duro a un archivo de fuera: sin `replace` lanza; con `replace` se separa', () => {
    const victim = join(outside, 'v.txt')
    writeFileSync(victim, 'ORIGINAL')
    linkSync(victim, join(root, 'a.txt'))
    expect(() => writeFileNoFollow(join(root, 'a.txt'), 'x')).toThrow(LinkRefusedError)
    writeFileNoFollow(join(root, 'a.txt'), 'nuevo', { replace: true })
    expect(readFileSync(victim, 'utf8')).toBe('ORIGINAL')
  })
  it('readFileNoFollow no lee el destino de un enlace, ni carpetas, ni lo que no existe', () => {
    const victim = join(outside, 's.txt')
    writeFileSync(victim, 'SECRETO')
    symlinkSync(victim, join(root, 'l.txt'))
    expect(readFileNoFollow(join(root, 'l.txt'))).toBeNull()
    expect(readFileNoFollow(outside)).toBeNull()
    expect(readFileNoFollow(join(root, 'no-existe'))).toBeNull()
    expect(readFileNoFollow(victim, 3)).toBeNull() // más grande que el tope
  })
  it('chmodDirNoFollow no cambia el modo del destino de un enlace', () => {
    const victimDir = join(outside, 'd')
    mkdirSync(victimDir, { mode: 0o755 })
    symlinkSync(victimDir, join(root, 'l'))
    expect(() => chmodDirNoFollow(join(root, 'l'), 0o700)).toThrow()
    expect(statSync(victimDir).mode & 0o777).toBe(0o755)
    mkdirSync(join(root, 'real'), { mode: 0o755 })
    chmodDirNoFollow(join(root, 'real'), 0o700)
    expect(statSync(join(root, 'real')).mode & 0o777).toBe(0o700)
  })
})

describe.skipIf(!posixOnly)('ensureTaskPrivateDir', () => {
  const iso = (): { privateDir: string; userData: string } => ({
    userData: join(root, 'ud'),
    privateDir: join(root, 'ud', 'tasks-sandbox', '0123456789abcdef')
  })
  it('crea la carpeta privada y sus subcarpetas fijas', () => {
    const dirs = ensureTaskPrivateDir(iso())
    for (const d of [dirs.root, dirs.config, dirs.data, dirs.cache, dirs.state, dirs.tmp]) expect(lstatSync(d).isDirectory()).toBe(true)
  })
  it('la carpeta privada como enlace: se quita el enlace (no el destino) y se crea una carpeta real', () => {
    const i = iso()
    mkdirSync(join(i.userData, 'tasks-sandbox'), { recursive: true })
    symlinkSync(outside, i.privateDir)
    const logs: string[] = []
    ensureTaskPrivateDir(i, (m) => logs.push(m))
    expect(lstatSync(i.privateDir).isSymbolicLink()).toBe(false)
    expect(readdirSync(outside)).toEqual([])
    expect(logs.length).toBe(1)
  })
  it('deja la config privada del motor (config/opencode) con su .gitignore, sin pisar uno existente ni seguir un enlace', () => {
    const i = iso()
    ensureTaskPrivateDir(i)
    const conf = join(i.privateDir, 'config', 'opencode')
    expect(readFileSync(join(conf, '.gitignore'), 'utf8')).toBe(ENGINE_GITIGNORE)
    writeFileSync(join(conf, '.gitignore'), 'propio')
    ensureTaskPrivateDir(i)
    expect(readFileSync(join(conf, '.gitignore'), 'utf8')).toBe('propio')
    rmSync(conf, { recursive: true })
    symlinkSync(outside, conf)
    ensureTaskPrivateDir(i)
    expect(lstatSync(conf).isSymbolicLink()).toBe(false)
    expect(readdirSync(outside)).toEqual([])
  })
  it('una subcarpeta fija como enlace: se quita el enlace y se crea la carpeta', () => {
    const i = iso()
    ensureTaskPrivateDir(i)
    rmSync(join(i.privateDir, 'cache'), { recursive: true })
    symlinkSync(outside, join(i.privateDir, 'cache'))
    ensureTaskPrivateDir(i)
    expect(lstatSync(join(i.privateDir, 'cache')).isSymbolicLink()).toBe(false)
    expect(readdirSync(outside)).toEqual([])
  })
  it('`tasks-sandbox` como enlace, o una carpeta privada fuera de userData: error claro, sin tocar el destino', () => {
    const i = iso()
    mkdirSync(i.userData, { recursive: true })
    symlinkSync(outside, join(i.userData, 'tasks-sandbox'))
    expect(() => ensureTaskPrivateDir(i)).toThrow(t('merr.task.privateDirUnsafe'))
    expect(readdirSync(outside)).toEqual([])
    expect(() => ensureTaskPrivateDir({ userData: join(root, 'ud2'), privateDir: join(root, 'otro', 'k') })).toThrow(
      t('merr.task.privateDirUnsafe')
    )
  })
  it('lo que ya había dentro se conserva (segunda tarea en la misma carpeta)', () => {
    const i = iso()
    ensureTaskPrivateDir(i)
    writeFileSync(join(i.privateDir, 'data', 'x'), 'sigo')
    ensureTaskPrivateDir(i)
    expect(readFileSync(join(i.privateDir, 'data', 'x'), 'utf8')).toBe('sigo')
  })
})
