/**
 * Corrección tras la revisión 2 (1.8.18): una tarea sobre una carpeta SIN permiso de escritura tiene que seguir arrancando (como en
 * 1.8.17). `ensureTaskAppDirs` no puede crear `.lazunox` ahí: si el sistema lo niega (EACCES/EPERM/EROFS) se salta esa carpeta y las
 * que cuelgan de ella y el arranque continúa; cualquier otro error, y un enlace o archivo en su lugar, siguen impidiendo el arranque.
 */
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { posixOnly } from '../../test/platform'

const fsState = vi.hoisted(() => ({ mkdirError: null as string | null }))
vi.mock('node:fs', async (orig) => {
  const real = await orig<typeof import('node:fs')>()
  return {
    ...real,
    default: real,
    mkdirSync: ((...a: Parameters<typeof real.mkdirSync>) => {
      if (fsState.mkdirError) throw Object.assign(new Error(`${fsState.mkdirError}: simulado`), { code: fsState.mkdirError })
      return real.mkdirSync(...a)
    }) as typeof real.mkdirSync
  }
})

import { t } from '@shared/i18n'
import { ensureTaskAppDirs } from './private-dir'
import { TASK_APP_DIRS } from './sandbox-profile'

const isRoot = typeof process.getuid === 'function' && process.getuid() === 0

describe('ensureTaskAppDirs: carpeta sin permiso de escritura', () => {
  let root: string
  let folder: string
  beforeEach(() => {
    fsState.mkdirError = null
    root = realpathSync(mkdtempSync(join(tmpdir(), 'lzx-ro-')))
    folder = join(root, 'tarea')
    mkdirSync(folder)
  })
  afterEach(() => {
    fsState.mkdirError = null
    try {
      chmodSync(folder, 0o755)
      chmodSync(join(folder, '.lazunox'), 0o755)
    } catch {
      /* puede no existir */
    }
    rmSync(root, { recursive: true, force: true })
  })

  it.skipIf(!posixOnly || isRoot)('chmod 555: no lanza, no crea nada y deja la carpeta como estaba', () => {
    chmodSync(folder, 0o555)
    expect(() => ensureTaskAppDirs(folder)).not.toThrow()
    expect(existsSync(join(folder, '.lazunox'))).toBe(false)
  })

  it.skipIf(!posixOnly || isRoot)('`.lazunox` existe pero es de solo lectura: se respeta y no se crea `trabajo` ni lo de debajo', () => {
    mkdirSync(join(folder, '.lazunox'))
    chmodSync(join(folder, '.lazunox'), 0o555)
    expect(() => ensureTaskAppDirs(folder)).not.toThrow()
    expect(existsSync(join(folder, '.lazunox', 'trabajo'))).toBe(false)
  })

  it.skipIf(!posixOnly || isRoot)('con carpetas ya creadas y la carpeta de solo lectura: no pasa nada', () => {
    for (const d of TASK_APP_DIRS) mkdirSync(join(folder, d), { recursive: true })
    chmodSync(folder, 0o555)
    expect(() => ensureTaskAppDirs(folder)).not.toThrow()
  })

  it.each(['EACCES', 'EPERM', 'EROFS'])('%s al crear: se salta y sigue', (code) => {
    fsState.mkdirError = code
    expect(() => ensureTaskAppDirs(folder)).not.toThrow()
    expect(existsSync(join(folder, '.lazunox'))).toBe(false)
  })

  it('errores del sistema llegan como frase clara, sin el código crudo', () => {
    const casos: Array<[string, string]> = [
      ['ENOTDIR', 'merr.task.appDirUnsafe'],
      ['EBUSY', 'merr.task.fileBusy'],
      ['ENOSPC', 'merr.task.diskFull'],
      ['ENAMETOOLONG', 'merr.task.pathTooLong']
    ]
    for (const [code, key] of casos) {
      fsState.mkdirError = code
      let msg = ''
      try {
        ensureTaskAppDirs(folder)
      } catch (e) {
        msg = (e as Error).message
      }
      expect(msg, code).toBe(t(key as 'merr.task.diskFull', { path: '.lazunox' }))
      expect(msg, code).not.toContain(code)
    }
  })

  it('un error desconocido (EIO) sigue fallando tal cual', () => {
    fsState.mkdirError = 'EIO'
    expect(() => ensureTaskAppDirs(folder)).toThrow('EIO')
  })

  it.skipIf(!posixOnly)('un enlace o un archivo en lugar de la carpeta sigue impidiendo el arranque con su mensaje', () => {
    const outside = join(root, 'fuera')
    mkdirSync(outside)
    symlinkSync(outside, join(folder, '.lazunox'))
    expect(() => ensureTaskAppDirs(folder)).toThrow(t('merr.task.appDirUnsafe', { path: '.lazunox' }))
    rmSync(join(folder, '.lazunox'))
    writeFileSync(join(folder, '.lazunox'), 'x')
    expect(() => ensureTaskAppDirs(folder)).toThrow(t('merr.task.appDirUnsafe', { path: '.lazunox' }))
    expect(lstatSync(join(folder, '.lazunox')).isFile()).toBe(true)
  })
})
