/**
 * Traducir Excel: corre el servicio de verdad con `translate_xlsx.py` y el Python incluido en la app (solo macOS arm64; se salta si
 * ese Python no está). Comprueba que la salida de `extraer` encaja con el servicio (ids, `pagina`) y que `aplicar` conserva
 * fórmulas y gráfico del libro.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const ROOT = resolve(__dirname, '../../..')
const PYTHON = join(ROOT, 'resources', 'python-bin', 'mac-arm64', 'python', 'bin', 'python3')
const SCRIPT = join(ROOT, 'resources', 'opencode', 'skills', 'xlsx', 'scripts', 'translate_xlsx.py')
const tienePython = process.platform === 'darwin' && process.arch === 'arm64' && existsSync(PYTHON)

vi.mock('electron', () => ({
  app: { getPath: () => tmpdir(), getAppPath: () => tmpdir(), isPackaged: false },
  dialog: { showSaveDialog: vi.fn() },
  shell: { openPath: vi.fn(async () => '') }
}))
vi.mock('../tasks/python-runtime', () => ({
  bundledPythonEnv: () => ({
    LAZUNOX_PYTHON: join(resolve(__dirname, '../../..'), 'resources', 'python-bin', 'mac-arm64', 'python', 'bin', 'python3'),
    PYTHONDONTWRITEBYTECODE: '1'
  })
}))

import { PdfTranslateService, runPythonReal } from './service'

const FIXTURE = `
import sys
import openpyxl
from openpyxl.chart import BarChart, Reference
from openpyxl.comments import Comment
wb = openpyxl.Workbook(); ws = wb.active; ws.title = "Ventas"
ws.append(["Producto", "Cantidad", "Precio"])
for n, q, p in [("Manzanas", 3, 2.5), ("Naranjas", 5, 1.2)]: ws.append([n, q, p])
ws["D1"] = "Total"
for r in (2, 3): ws[f"D{r}"] = f"=B{r}*C{r}"
ws["A2"].comment = Comment("Fruta fresca", "yo")
c = BarChart(); c.title = "Ventas por producto"; c.add_data(Reference(ws, min_col=2, min_row=1, max_row=3), titles_from_data=True); ws.add_chart(c, "F2")
wb.save(sys.argv[1])
`

const LEER = `
import sys, zipfile, re
z = zipfile.ZipFile(sys.argv[1])
hoja = z.read("xl/worksheets/sheet1.xml").decode()
print("FORMULAS", sorted(re.findall(r"<f>([^<]*)</f>", hoja)))
print("GRAFICO", any(n.startswith("xl/charts/chart") for n in z.namelist()))
print("TEXTO", "Sales by product" in z.read("xl/charts/chart1.xml").decode())
`

describe.skipIf(!tienePython)('traducir Excel con el script real', () => {
  let dir: string
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'lzx-xlsx-'))
    writeFileSync(join(dir, 'fixture.py'), FIXTURE)
    writeFileSync(join(dir, 'leer.py'), LEER)
    execFileSync(PYTHON, ['-I', join(dir, 'fixture.py'), join(dir, 'ventas.xlsx')], { env: { PYTHONDONTWRITEBYTECODE: '1' } })
  })
  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  it('extrae segmentos que el servicio acepta y aplica conservando fórmulas y gráfico', async () => {
    const svc = new PdfTranslateService({
      jobsDir: () => join(dir, 'jobs'),
      chatDocsDir: () => join(dir, 'chat-docs'),
      python: () => PYTHON,
      script: () => SCRIPT,
      run: runPythonReal,
      now: () => Date.now(),
      renderHtml: async () => Buffer.alloc(0)
    })
    const base64 = readFileSync(join(dir, 'ventas.xlsx')).toString('base64')
    const ex = await svc.extract({ name: 'ventas.xlsx', base64, kind: 'xlsx' })
    expect(ex.ok).toBe(true)
    if (!ex.ok) return
    expect(ex.segments.length).toBeGreaterThanOrEqual(6)
    expect(ex.segments.every((s) => s.pagina === 1)).toBe(true)
    const chart = ex.segments.find((s) => s.texto === 'Ventas por producto')
    expect(chart).toBeDefined()
    const translations = Object.fromEntries(ex.segments.map((s) => [s.id, s.id === chart!.id ? 'Sales by product' : `${s.texto} (en)`]))
    const r = await svc.apply({ jobId: ex.jobId, target: 'en', translations })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.outName).toBe('ventas (en).xlsx')
    expect(r.report.translated).toBe(ex.segments.length)
    const out = join(dir, 'jobs', ex.jobId, r.outName)
    const salida = execFileSync(PYTHON, ['-I', join(dir, 'leer.py'), out], { env: { PYTHONDONTWRITEBYTECODE: '1' } }).toString()
    expect(salida).toContain("FORMULAS ['B2*C2', 'B3*C3']")
    expect(salida).toContain('GRAFICO True')
    expect(salida).toContain('TEXTO True')
    await svc.discard(ex.jobId)
  }, 60_000)
})
