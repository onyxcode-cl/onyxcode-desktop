import { mkdtempSync, existsSync, readFileSync, writeFileSync, rmSync, readdirSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: { getPath: () => tmpdir(), getAppPath: () => tmpdir(), isPackaged: false },
  dialog: { showSaveDialog: vi.fn() },
  shell: { openPath: vi.fn(async () => '') }
}))
vi.mock('../tasks/python-runtime', () => ({ bundledPythonEnv: () => ({ LAZUNOX_PYTHON: '/fake/python3' }) }))

import { dialog, shell } from 'electron'
import { PdfTranslateService, type RunResult, type ServiceDeps } from './service'

const PDF_B64 = Buffer.from('%PDF-1.7\n%fake\n').toString('base64')
const ok = (extra: Partial<RunResult> = {}): RunResult => ({ code: 0, stdout: '', stderr: '', timedOut: false, ...extra })

let root: string
let script: string
let now = 1_000_000

function deps(run: ServiceDeps['run']): ServiceDeps {
  return { jobsDir: () => join(root, 'jobs'), python: () => '/fake/python3', script: () => script, run, now: () => now }
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'lzx-tpdf-'))
  script = join(root, 'translate_pdf.py')
  writeFileSync(script, '# fake')
  now = 1_000_000
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

const segJson = (n: number) =>
  JSON.stringify({
    paginas: 3,
    segmentos: Array.from({ length: n }, (_, i) => ({ id: `p${i < 2 ? 1 : 3}-${i}`, pagina: i < 2 ? 1 : 3, texto: `texto ${i}` }))
  })

describe('extract (Word)', () => {
  const DOCX_B64 = Buffer.from('PK\u0003\u0004fake').toString('base64')
  it('un .docx usa su propia herramienta y archivos .docx; ids d<parte>-<n>', async () => {
    const run = vi.fn(async (_py: string, args: string[], cwd: string) => {
      expect(args.slice(1)).toEqual(['extraer', 'input.docx', '-o', 'segmentos.json'])
      writeFileSync(join(cwd, 'segmentos.json'), JSON.stringify({ paginas: 1, segmentos: [{ id: 'd1-0', pagina: 1, texto: 'Hola' }] }))
      return ok()
    })
    const r = await new PdfTranslateService(deps(run)).extract({ name: 'a.docx', base64: DOCX_B64, kind: 'docx' })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.segments.map((s) => s.id)).toEqual(['d1-0'])
    expect(existsSync(join(root, 'jobs', r.jobId, 'input.docx'))).toBe(true)
  })
  it('un PDF presentado como Word (y al revés) se rechaza sin llamar a Python', async () => {
    const run = vi.fn()
    const s = new PdfTranslateService(deps(run))
    expect(await s.extract({ name: 'a.docx', base64: PDF_B64, kind: 'docx' })).toEqual({ ok: false, reason: 'unreadable' })
    expect(await s.extract({ name: 'a.pdf', base64: DOCX_B64 })).toEqual({ ok: false, reason: 'unreadable' })
    expect(run).not.toHaveBeenCalled()
  })
})

describe('extract', () => {
  it('guarda el PDF en una carpeta propia y devuelve los textos y las páginas sin texto', async () => {
    const run = vi.fn(async (_py: string, args: string[], cwd: string) => {
      expect(args.slice(1)).toEqual(['extraer', 'input.pdf', '-o', 'segmentos.json'])
      writeFileSync(join(cwd, 'segmentos.json'), segJson(3))
      return ok()
    })
    const r = await new PdfTranslateService(deps(run)).extract({ name: 'a.pdf', base64: PDF_B64 })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.jobId).toMatch(/^[a-f0-9]{16}$/)
    expect(r.pages).toBe(3)
    expect(r.segments).toHaveLength(3)
    expect(r.pagesWithoutText).toEqual([2])
    expect(existsSync(join(root, 'jobs', r.jobId, 'input.pdf'))).toBe(true)
  })

  it('rechaza lo que no es un PDF, sin llamar a Python', async () => {
    const run = vi.fn()
    const r = await new PdfTranslateService(deps(run)).extract({ name: 'a.pdf', base64: Buffer.from('hola mundo').toString('base64') })
    expect(r).toEqual({ ok: false, reason: 'unreadable' })
    expect(run).not.toHaveBeenCalled()
  })

  it('sin Python incluido avisa y no crea carpetas', async () => {
    const d = { ...deps(vi.fn()), python: () => null }
    expect(await new PdfTranslateService(d).extract({ name: 'a.pdf', base64: PDF_B64 })).toEqual({ ok: false, reason: 'noPython' })
    expect(existsSync(join(root, 'jobs'))).toBe(false)
  })

  it.each([
    [{ code: 2, stderr: 'AVISO: ESCANEADO' }, 'scanned'],
    [{ code: 1, stderr: 'ERROR: el PDF tiene contraseña' }, 'encrypted'],
    [{ code: 1, stderr: 'ERROR: no se pudo abrir x' }, 'unreadable'],
    [{ code: 1, stderr: 'algo raro' }, 'failed'],
    [{ code: 1, timedOut: true }, 'timeout']
  ] as [Partial<RunResult>, string][])('fallos de Python %j → %s y se borra el trabajo', async (res, reason) => {
    const r = await new PdfTranslateService(deps(vi.fn(async () => ok(res)))).extract({ name: 'a.pdf', base64: PDF_B64 })
    expect(r).toEqual({ ok: false, reason })
    expect(readdirSync(join(root, 'jobs'))).toEqual([])
  })

  it('un PDF con demasiados textos se rechaza', async () => {
    const run = async (_p: string, _a: string[], cwd: string): Promise<RunResult> => {
      writeFileSync(
        join(cwd, 'segmentos.json'),
        JSON.stringify({ paginas: 1, segmentos: [{ id: 'p1-0', pagina: 1, texto: 'x'.repeat(450_000) }] })
      )
      return ok()
    }
    expect(await new PdfTranslateService(deps(run)).extract({ name: 'a.pdf', base64: PDF_B64 })).toEqual({ ok: false, reason: 'tooLong' })
  })

  it('descarta segmentos con ids raros', async () => {
    const run = async (_p: string, _a: string[], cwd: string): Promise<RunResult> => {
      writeFileSync(
        join(cwd, 'segmentos.json'),
        JSON.stringify({
          paginas: 1,
          segmentos: [
            { id: '../../x', pagina: 1, texto: 'a' },
            { id: 'p1-0', pagina: 1, texto: 'b' }
          ]
        })
      )
      return ok()
    }
    const r = await new PdfTranslateService(deps(run)).extract({ name: 'a.pdf', base64: PDF_B64 })
    expect(r.ok && r.segments.map((s) => s.id)).toEqual(['p1-0'])
  })
})

describe('apply / open / save / discard', () => {
  async function extracted(svc: PdfTranslateService): Promise<string> {
    const r = await svc.extract({ name: 'Informe.pdf', base64: PDF_B64 })
    if (!r.ok) throw new Error('extract falló')
    return r.jobId
  }
  const runBoth =
    (applyCode = 0): ServiceDeps['run'] =>
    async (_p, args, cwd) => {
      if (args[1] === 'extraer') writeFileSync(join(cwd, 'segmentos.json'), segJson(2))
      else {
        writeFileSync(join(cwd, 'salida.pdf'), '%PDF-out')
        writeFileSync(
          join(cwd, 'informe.json'),
          JSON.stringify({
            traducidos: 2,
            sin_traduccion: [],
            letra_reducida: [{}, {}, {}],
            no_cabe: ['p1-1', '../x'],
            enlaces_quitados: [1]
          })
        )
      }
      return ok({ code: args[1] === 'aplicar' ? applyCode : 0 })
    }

  it('escribe las traducciones válidas y devuelve el informe (código 3 = algo no cabe, pero hay PDF)', async () => {
    const svc = new PdfTranslateService(deps(runBoth(3)))
    const jobId = await extracted(svc)
    const r = await svc.apply({ jobId, target: 'en', translations: { 'p1-0': 'one', 'p1-1': 'two', '../../etc': 'x', 'p1-9': '   ' } })
    expect(r).toEqual({
      ok: true,
      outName: 'Informe (en).pdf',
      report: { translated: 2, untranslated: 0, shrunk: 3, overflow: ['p1-1'], linksDropped: 1 }
    })
    const sent = JSON.parse(readFileSync(join(root, 'jobs', jobId, 'traduccion.json'), 'utf8'))
    expect(sent).toEqual({ 'p1-0': 'one', 'p1-1': 'two' })
    expect(existsSync(join(root, 'jobs', jobId, 'Informe (en).pdf'))).toBe(true)
  })

  it('un jobId inventado o con ruta no hace nada', async () => {
    const svc = new PdfTranslateService(deps(runBoth()))
    expect(await svc.apply({ jobId: '../../../etc', target: 'en', translations: { 'p1-0': 'x' } })).toEqual({ ok: false, reason: 'failed' })
    expect(await svc.apply({ jobId: '0123456789abcdef', target: 'en', translations: { 'p1-0': 'x' } })).toEqual({
      ok: false,
      reason: 'failed'
    })
    expect(await svc.open('../../etc')).toEqual({ opened: false })
  })

  it('sin traducciones válidas no ejecuta Python', async () => {
    const run = vi.fn(runBoth())
    const svc = new PdfTranslateService(deps(run))
    const jobId = await extracted(svc)
    run.mockClear()
    expect(await svc.apply({ jobId, target: 'en', translations: { zz: 'x' } })).toEqual({ ok: false, reason: 'failed' })
    expect(run).not.toHaveBeenCalled()
  })

  it('open abre el PDF traducido con el visor del sistema; save copia donde elija la persona', async () => {
    const svc = new PdfTranslateService(deps(runBoth()))
    const jobId = await extracted(svc)
    expect(await svc.open(jobId)).toEqual({ opened: false }) // todavía no hay traducción
    await svc.apply({ jobId, target: 'fr', translations: { 'p1-0': 'un' } })
    expect(await svc.open(jobId)).toEqual({ opened: true })
    expect(vi.mocked(shell.openPath)).toHaveBeenCalledWith(join(root, 'jobs', jobId, 'Informe (fr).pdf'))
    const dest = join(root, 'elegido.pdf')
    vi.mocked(dialog.showSaveDialog).mockResolvedValueOnce({ canceled: false, filePath: dest })
    expect(await svc.save(jobId, null)).toEqual({ saved: true })
    expect(readFileSync(dest, 'utf8')).toBe('%PDF-out')
    vi.mocked(dialog.showSaveDialog).mockResolvedValueOnce({ canceled: true, filePath: '' })
    expect(await svc.save(jobId, null)).toEqual({ saved: false })
  })

  it('discard borra el trabajo y cleanup borra los de más de 24 h', async () => {
    const svc = new PdfTranslateService(deps(runBoth()))
    const a = await extracted(svc)
    const b = await extracted(svc)
    await svc.discard(a)
    expect(existsSync(join(root, 'jobs', a))).toBe(false)
    expect(existsSync(join(root, 'jobs', b))).toBe(true)
    now += 25 * 60 * 60 * 1000
    await svc.cleanup()
    expect(readdirSync(join(root, 'jobs'))).toEqual([])
  })

  it('cleanup borra también carpetas ajenas al formato', async () => {
    const svc = new PdfTranslateService(deps(runBoth()))
    await extracted(svc)
    const ajena = join(root, 'jobs', 'cualquier-cosa')
    writeFileSync(join(root, 'jobs', 'suelto.txt'), 'x')
    utimesSync(join(root, 'jobs', 'suelto.txt'), new Date(), new Date())
    await svc.cleanup()
    expect(existsSync(ajena)).toBe(false)
    expect(existsSync(join(root, 'jobs', 'suelto.txt'))).toBe(false)
  })
})
