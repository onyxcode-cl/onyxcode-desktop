/**
 * El proceso principal no escribe, copia, borra ni cambia permisos A TRAVÉS de un enlace simbólico que una tarea dejó en su carpeta
 * privada o en su carpeta de trabajo (1.8.18): temporales de nombre fijo (`AGENTS.md`, skills), permisos guardados, limpieza de
 * almacenamiento, skills aprobadas, importación de archivos, descargas del navegador integrado y memoria. (El sembrado en la carpeta
 * privada se eliminó en la corrección tras la revisión 1.) Enlaces simbólicos sin privilegios: solo macOS/Linux.
 */
import {
  existsSync,
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
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ userData: '' }))
vi.mock('electron', () => ({ app: { getPath: () => state.userData }, dialog: {} }))

import { t } from '@shared/i18n'
import { posixOnly } from '../../test/platform'
import { moveDownloadIntoTaskFolder } from '../embedded-browser/downloads'
import { ensureSandboxPermissionDir, forgetSavedPermissions, sandboxPermissionDir } from '../opencode/permission-store'
import { importFilesInto } from './files'
import { removeSkill, writeApprovedSkill } from './learned-skills'
import { deleteMemory, getMemory, saveAgentsMd, saveMemory } from './projects'
import { storageClean } from './storage'

let root: string
let outside: string
beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'lzx-enlaces-main-')))
  outside = join(root, 'fuera')
  mkdirSync(outside)
  state.userData = join(root, 'ud')
  mkdirSync(state.userData)
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

describe.skipIf(!posixOnly)('temporales de nombre fijo (corrección tras la revisión 1)', () => {
  it('saveAgentsMd: `AGENTS.md.lazunox-tmp` dejado como enlace a un archivo de fuera ya no se sigue', () => {
    const f = join(root, 'a1')
    mkdirSync(f)
    writeFileSync(join(outside, 'zshrc'), 'ORIGINAL')
    symlinkSync(join(outside, 'zshrc'), join(f, 'AGENTS.md.lazunox-tmp'))
    expect(saveAgentsMd(f, 'INSTRUCCIONES').content).toBe('INSTRUCCIONES')
    expect(readFileSync(join(outside, 'zshrc'), 'utf8')).toBe('ORIGINAL')
    expect(lstatSync(join(f, 'AGENTS.md')).isSymbolicLink()).toBe(false)
  })
  it('saveAgentsMd: un AGENTS.md enlazado DENTRO de la carpeta se sigue respetando (se escribe su destino real)', () => {
    const f = join(root, 'a2')
    mkdirSync(join(f, 'docs'), { recursive: true })
    writeFileSync(join(f, 'docs', 'AGENTS.md'), 'viejo')
    symlinkSync(join(f, 'docs', 'AGENTS.md'), join(f, 'AGENTS.md'))
    saveAgentsMd(f, 'nuevo')
    expect(readFileSync(join(f, 'docs', 'AGENTS.md'), 'utf8')).toBe('nuevo')
    expect(lstatSync(join(f, 'AGENTS.md')).isSymbolicLink()).toBe(true)
  })
  it('writeApprovedSkill: `SKILL.md.tmp` dejado como enlace ya no importa', () => {
    const f = join(root, 'a3')
    mkdirSync(join(f, '.opencode', 'skills', 'mi-skill'), { recursive: true })
    writeFileSync(join(outside, 'x'), 'NO TOCAR')
    symlinkSync(join(outside, 'x'), join(f, '.opencode', 'skills', 'mi-skill', 'SKILL.md.tmp'))
    expect(writeApprovedSkill(f, { name: 'mi-skill', description: 'd', body: 'b' })).toMatchObject({ ok: true })
    expect(readFileSync(join(outside, 'x'), 'utf8')).toBe('NO TOCAR')
  })
})

describe.skipIf(!posixOnly)('permisos guardados de la tarea (permission-store)', () => {
  const priv = (): string => {
    const p = join(state.userData, 'tasks-sandbox', '0123456789abcdef')
    mkdirSync(p, { recursive: true })
    return p
  }
  it('ensureSandboxPermissionDir: un enlace en `permisos-siempre` se cambia por una carpeta 0700; el destino no cambia de modo', () => {
    const p = priv()
    mkdirSync(join(outside, 'd'), { mode: 0o755 })
    symlinkSync(join(outside, 'd'), sandboxPermissionDir(p))
    ensureSandboxPermissionDir(p)
    expect(lstatSync(sandboxPermissionDir(p)).isSymbolicLink()).toBe(false)
    expect(statSync(sandboxPermissionDir(p)).mode & 0o777).toBe(0o700)
    expect(statSync(join(outside, 'd')).mode & 0o777).toBe(0o755)
  })
  it('forgetSavedPermissions no vacía el destino de un enlace (ni de la carpeta privada ni de `permisos-siempre`)', () => {
    const p = priv()
    writeFileSync(join(outside, 'mio.txt'), 'x')
    symlinkSync(outside, sandboxPermissionDir(p))
    symlinkSync(outside, join(state.userData, 'tasks-sandbox', 'fedcba9876543210'))
    forgetSavedPermissions(state.userData)
    expect(readdirSync(outside)).toEqual(['mio.txt'])
  })
  it('forgetSavedPermissions sigue vaciando la carpeta real', () => {
    const p = priv()
    ensureSandboxPermissionDir(p)
    writeFileSync(join(sandboxPermissionDir(p), 'r.json'), '{}')
    expect(forgetSavedPermissions(state.userData)).toBe(1)
    expect(readdirSync(sandboxPermissionDir(p))).toEqual([])
  })
})

describe.skipIf(!posixOnly)('limpieza de almacenamiento (storageClean)', () => {
  const env = () => ({ userData: state.userData, screenshotsDir: join(root, 'shots'), sandboxKey: () => 'x', du: async () => 0 })
  it('«cache» con la carpeta privada como enlace: se quita el enlace y no se borra nada del destino', async () => {
    mkdirSync(join(outside, 'cache'))
    mkdirSync(join(outside, 'tmp'))
    mkdirSync(join(state.userData, 'tasks-sandbox'))
    symlinkSync(outside, join(state.userData, 'tasks-sandbox', '0123456789abcdef'))
    await storageClean(env(), [], [], '0123456789abcdef', 'cache')
    expect(readdirSync(outside).sort()).toEqual(['cache', 'tmp'])
    expect(existsSync(join(state.userData, 'tasks-sandbox', '0123456789abcdef'))).toBe(false)
  })
  it('lo normal: «cache» borra cache/ y tmp/ de la carpeta real', async () => {
    const p = join(state.userData, 'tasks-sandbox', '0123456789abcdef')
    for (const d of ['cache', 'tmp', 'data']) mkdirSync(join(p, d), { recursive: true })
    await storageClean(env(), [], [], '0123456789abcdef', 'cache')
    expect(readdirSync(p)).toEqual(['data'])
  })
})

describe.skipIf(!posixOnly)('carpeta de la tarea: skills, importar archivos, descargas', () => {
  const folder = (): string => {
    const f = join(root, 'tarea')
    mkdirSync(f, { recursive: true })
    return f
  }
  const skill = { name: 'mi-skill', description: 'hace algo', body: 'pasos' }
  it('skill aprobada con `.opencode` como enlace: error claro y nada se escribe en el destino', () => {
    const f = folder()
    symlinkSync(outside, join(f, '.opencode'))
    expect(() => writeApprovedSkill(f, skill)).toThrow(t('merr.task.linkInFolder', { path: join('.opencode', 'skills', 'mi-skill') }))
    expect(readdirSync(outside)).toEqual([])
  })
  it('skill: lo normal se escribe; removeSkill no borra a través de un enlace', () => {
    const f = folder()
    expect(writeApprovedSkill(f, skill)).toMatchObject({ ok: true })
    expect(readFileSync(join(f, '.opencode', 'skills', 'mi-skill', 'SKILL.md'), 'utf8')).toContain('pasos')
    const f2 = join(root, 'tarea2')
    mkdirSync(join(outside, 'skills', 'mi-skill'), { recursive: true })
    writeFileSync(join(outside, 'skills', 'mi-skill', 'SKILL.md'), 'ajena')
    mkdirSync(f2)
    symlinkSync(outside, join(f2, '.opencode'))
    expect(removeSkill(f2, 'mi-skill')).toBe(false)
    expect(readFileSync(join(outside, 'skills', 'mi-skill', 'SKILL.md'), 'utf8')).toBe('ajena')
    expect(removeSkill(f, 'mi-skill')).toBe(true)
  })
  it('importar un archivo cuyo nombre es un enlace roto hacia fuera: no se crea el destino; se usa otro nombre', () => {
    const f = folder()
    const src = join(root, 'informe.txt')
    writeFileSync(src, 'contenido')
    symlinkSync(join(outside, 'nuevo.plist'), join(f, 'informe.txt'))
    const [d] = importFilesInto(f, [src])
    expect(existsSync(join(outside, 'nuevo.plist'))).toBe(false)
    expect(d!.relPath).toBe('informe (2).txt')
    expect(readFileSync(join(f, 'informe (2).txt'), 'utf8')).toBe('contenido')
  })
  it('descarga de la tarea: con `descargas` como enlace no se mueve a través de él; lo normal sí', async () => {
    const f = folder()
    const dir = join(f, '.lazunox', 'trabajo', 'descargas')
    mkdirSync(join(f, '.lazunox', 'trabajo'), { recursive: true })
    symlinkSync(outside, dir)
    const staged = join(root, 'staged.plist')
    writeFileSync(staged, '<plist/>')
    expect(await moveDownloadIntoTaskFolder(staged, f, dir, 'x.plist')).toBeNull()
    expect(readdirSync(outside)).toEqual([])
    rmSync(dir)
    expect(await moveDownloadIntoTaskFolder(staged, f, dir, 'x.plist')).toBe(join(dir, 'x.plist'))
    // Un enlace roto con el mismo nombre: se elige otro nombre y el destino del enlace no se crea.
    writeFileSync(staged, 'otra')
    symlinkSync(join(outside, 'y.plist'), join(dir, 'y.plist'))
    expect(await moveDownloadIntoTaskFolder(staged, f, dir, 'y.plist')).toBe(join(dir, 'y (2).plist'))
    expect(existsSync(join(outside, 'y.plist'))).toBe(false)
  })
})

describe.skipIf(!posixOnly)('memoria de la tarea (.lazunox/memoria.md)', () => {
  it('memoria.md como enlace: no se lee, no se escribe y borrar quita solo el enlace', () => {
    const f = join(root, 'm1')
    mkdirSync(join(f, '.lazunox'), { recursive: true })
    writeFileSync(join(outside, 's.txt'), 'SECRETO')
    symlinkSync(join(outside, 's.txt'), join(f, '.lazunox', 'memoria.md'))
    expect(getMemory(f)).toMatchObject({ content: '', exists: false })
    expect(() => saveMemory(f, 'x')).toThrow(t('merr.projects.memoryLink'))
    deleteMemory(f)
    expect(readFileSync(join(outside, 's.txt'), 'utf8')).toBe('SECRETO')
    expect(existsSync(join(f, '.lazunox', 'memoria.md'))).toBe(false)
  })
  it('.lapis (memoria antigua) como enlace a una carpeta: no se lee ni se borra su memoria.md', () => {
    const f = join(root, 'm2')
    mkdirSync(f)
    writeFileSync(join(outside, 'memoria.md'), 'AJENA')
    symlinkSync(outside, join(f, '.lapis'))
    expect(getMemory(f).content).toBe('')
    deleteMemory(f)
    expect(readFileSync(join(outside, 'memoria.md'), 'utf8')).toBe('AJENA')
  })
  it('lo normal: guardar, leer y borrar', () => {
    const f = join(root, 'm3')
    mkdirSync(f)
    expect(saveMemory(f, 'nota').content).toBe('nota')
    expect(getMemory(f).exists).toBe(true)
    expect(deleteMemory(f).exists).toBe(false)
  })
})
