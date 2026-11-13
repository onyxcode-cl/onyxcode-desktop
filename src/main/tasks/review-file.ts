/**
 * Revisión de calidad de un Word/Excel/PowerPoint ya entregado, para el indicador de la tarjeta del archivo. Se calcula sobre los bytes
 * del archivo en el momento de pedirla (la misma lista de `documents/review.ts`), sin guardar nada: así sirve igual si el archivo lo
 * creó `documentos_crear` o lo armó el agente con `bash` (Mac y WSL), y si el usuario lo cambió después se revisa de nuevo, nunca queda
 * un ✔ viejo. También ofrece rellenar cachés de fórmulas ausentes en `.xlsx` recientes al terminar el turno. La ruta debe venir YA
 * validada con `TasksManager.assertInsideApproved`.
 */
import { app } from 'electron'
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, extname, join } from 'node:path'
import type { TasksFileReview } from '@shared/ipc-tasks'
import { reviewDocument } from '../documents/review'
import { findBundledPython } from './python-runtime'
import { unpacked } from '../util/asar'
import { safeWriteFile } from './safe-write'

const KINDS = { '.docx': 'docx', '.xlsx': 'xlsx', '.pptx': 'pptx' } as const
const MAX_BYTES = 25 * 1024 * 1024
const UNAVAILABLE: TasksFileReview = { status: 'unavailable', items: [] }

export type RunFormulaCache = (python: string, args: string[], timeoutMs: number) => Promise<void>

const runFormulaCache: RunFormulaCache = (python, args, timeoutMs) =>
  new Promise((resolve, reject) => {
    execFile(python, args, { timeout: timeoutMs, windowsHide: true, maxBuffer: 64 * 1024 }, (err) => (err ? reject(err) : resolve()))
  })

/** Completa solo valores calculables que falten en la caché OOXML; conserva las fórmulas del libro. */
export async function cacheXlsxFormulaValues(path: string, run: RunFormulaCache = runFormulaCache): Promise<boolean> {
  if (extname(path).toLowerCase() !== '.xlsx') return false
  let before: Awaited<ReturnType<typeof stat>>
  try {
    before = await stat(path)
    if (!before.isFile() || before.size > MAX_BYTES) return false
  } catch {
    return false
  }
  const python = findBundledPython({
    platform: process.platform,
    arch: process.arch,
    resourcesPath: app.isPackaged ? process.resourcesPath : undefined,
    appPath: app.getAppPath(),
    exists: existsSync
  })
  if (!python) return false
  const script = unpacked(join(app.getAppPath(), 'resources', 'opencode', 'skills', 'xlsx', 'scripts', 'formula_cache.py'))
  let tempDir: string | null = null
  try {
    tempDir = await mkdtemp(join(tmpdir(), 'lazunox-xlsx-cache-'))
    const output = join(tempDir, 'calculado.xlsx')
    const code = [
      'import sys',
      'sys.path.insert(0, sys.argv[1])',
      'from openpyxl import load_workbook',
      'import formula_cache',
      'path = sys.argv[2]',
      'output = sys.argv[3]',
      'wb = load_workbook(path)',
      'values, unsupported = formula_cache.calculate(wb)',
      'cached = formula_cache.read_cached_values(path)',
      'if values and any(cached.get(key) is None for key in values): formula_cache.save_with_cache(wb, output)',
      'wb.close()'
    ].join('\n')
    await run(python, ['-I', '-c', code, join(script, '..'), path, output], 20_000)
    const data = await readFile(output).catch(() => null)
    if (!data) return false
    const after = await stat(path)
    if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size || before.mtimeMs !== after.mtimeMs) return false
    safeWriteFile(dirname(path), path, data, { replace: true, refuseLinkTarget: true })
    return true
  } catch {
    return false
  } finally {
    if (tempDir) await rm(tempDir, { recursive: true, force: true }).catch(() => undefined)
  }
}

export async function reviewFile(path: string, review: typeof reviewDocument = reviewDocument): Promise<TasksFileReview> {
  const kind = (KINDS as Record<string, 'docx' | 'xlsx' | 'pptx' | undefined>)[extname(path).toLowerCase()]
  if (!kind) return UNAVAILABLE
  try {
    const st = await stat(path)
    if (!st.isFile() || st.size > MAX_BYTES) return UNAVAILABLE
    const res = await review(kind, await readFile(path))
    return {
      status: res.ok ? 'ok' : 'issues',
      items: res.items.map((i) => (i.note ? { ok: i.ok, text: i.text, note: true } : { ok: i.ok, text: i.text }))
    }
  } catch {
    return UNAVAILABLE
  }
}
