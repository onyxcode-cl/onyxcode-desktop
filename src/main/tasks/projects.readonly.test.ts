/** Memoria de una tarea sobre una carpeta sin permiso de escritura (revisión 2): leer sigue bien y guardar da un mensaje claro por i18n. */
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getPath: () => tmpdir() } }))

import { t } from '@shared/i18n'
import { posixOnly } from '../../test/platform'
import { getMemory, saveMemory } from './projects'

const isRoot = typeof process.getuid === 'function' && process.getuid() === 0

describe.skipIf(!posixOnly || isRoot)('memoria en carpeta de solo lectura', () => {
  let root: string
  let folder: string
  beforeEach(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), 'lzx-mem-ro-')))
    folder = join(root, 'tarea')
    mkdirSync(folder)
    chmodSync(folder, 0o555)
  })
  afterEach(() => {
    chmodSync(folder, 0o755)
    rmSync(root, { recursive: true, force: true })
  })

  it('leer: sin memoria y sin error', () => {
    expect(getMemory(folder)).toEqual({ content: '', exists: false, updatedAt: null })
  })

  it('guardar: error claro (no el EACCES crudo en inglés)', () => {
    expect(() => saveMemory(folder, 'hola')).toThrow(t('merr.task.folderReadOnly', { path: '.lazunox' }))
  })
})
