/**
 * Banco de documentos difíciles: corre `resources/opencode/skills/_shared/tests/test_banco.py` (traducir y editar Word, Excel, PowerPoint
 * y PDF con papelera, partes huérfanas, Word de Mac, Google, LibreOffice, WPS, comentarios, cambios, OLE, macros, ZIP raros, tablas
 * dinámicas y medios; los archivos se fabrican con código) con el Python incluido en la app, en macOS y en Windows.
 * Se salta si ese Python no está (`scripts/fetch-python.mjs`; en la PC de Windows: `STEPS=python,unit`). `LAZUNOX_PYTHON` lo reemplaza.
 */
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = resolve(__dirname, '../../..')
const SKILLS = join(ROOT, 'resources', 'opencode', 'skills', '_shared')
const BUNDLED =
  process.platform === 'win32'
    ? join(ROOT, 'resources', 'python-bin', 'win-x64', 'python', 'python.exe')
    : join(ROOT, 'resources', 'python-bin', 'mac-arm64', 'python', 'bin', 'python3')
const PYTHON = process.env.LAZUNOX_PYTHON || BUNDLED
const tienePython = existsSync(PYTHON)

describe.skipIf(!tienePython)('banco de documentos difíciles (traducir y editar)', () => {
  it('todos los archivos del banco se traducen y se editan sin fallar, y el original no se toca', () => {
    const r = spawnSync(PYTHON, ['-m', 'unittest', 'tests.test_banco', 'tests.test_comparar'], {
      cwd: SKILLS,
      env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1', LAZUNOX_PYTHON: PYTHON, PYTHONIOENCODING: 'utf-8' },
      encoding: 'utf8',
      timeout: 8 * 60 * 1000
    })
    const out = `${r.stdout ?? ''}\n${r.stderr ?? ''}`
    expect(r.status, out.slice(-3000)).toBe(0)
    expect(out).toMatch(/\nOK/)
  }, 600_000)
})
