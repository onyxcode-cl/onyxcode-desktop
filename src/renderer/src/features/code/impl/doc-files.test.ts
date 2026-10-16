import { describe, expect, it } from 'vitest'
import type { Part } from '@opencode-ai/sdk/v2/client'
import { detectDocFiles, normalizeAbs } from './doc-files'

const ROOT = '/Users/ben/Proyecto con espacio'
const tool = (name: string, input: Record<string, unknown>, output = ''): Part =>
  ({
    id: `${name}-${Math.random()}`,
    type: 'tool',
    tool: name,
    callID: 'c',
    state: { status: 'completed', input, output }
  }) as unknown as Part
const text = (t: string): Part => ({ id: 't', type: 'text', text: t }) as unknown as Part

describe('detectDocFiles', () => {
  it('toma el archivo de write/edit, relativo o absoluto, resuelto contra el proyecto', () => {
    const r = detectDocFiles({
      parts: [tool('write', { filePath: 'out/informe.xlsx' }), tool('edit', { filePath: `${ROOT}/a.docx` })],
      root: ROOT
    })
    expect(r).toEqual([`${ROOT}/out/informe.xlsx`, `${ROOT}/a.docx`])
  })
  it('ignora archivos que no son documento y herramientas fallidas', () => {
    const failed = {
      ...tool('write', { filePath: 'x.xlsx' }),
      state: { status: 'error', input: { filePath: 'x.xlsx' } }
    } as unknown as Part
    expect(detectDocFiles({ parts: [tool('write', { filePath: 'src/a.ts' }), failed], root: ROOT })).toEqual([])
  })
  it('lee rutas de un parche', () => {
    const patch = '*** Begin Patch\n*** Add File: docs/plan.pptx\n+x\n*** End Patch'
    expect(detectDocFiles({ parts: [tool('apply_patch', { patchText: patch })], root: ROOT })).toEqual([`${ROOT}/docs/plan.pptx`])
  })
  it('encuentra rutas absolutas con espacios y acentos en el texto', () => {
    const t = 'Actualicé el PDF: /Users/ben/Documents/prueba/negocios ganados ñ 2026.pdf y listo.'
    expect(detectDocFiles({ parts: [text(t)], root: ROOT })).toEqual(['/Users/ben/Documents/prueba/negocios ganados ñ 2026.pdf'])
  })
  it('en el texto no toma nombres relativos sueltos, pero en la salida de un comando sí', () => {
    expect(detectDocFiles({ parts: [text('mira informe.xlsx')], root: ROOT })).toEqual([])
    const r = detectDocFiles({
      parts: [tool('bash', { command: 'python make.py' }, 'Guardado: informe.xlsx (12 KB)\nTambién ./sub/b.pdf')],
      root: ROOT
    })
    expect(r).toEqual([`${ROOT}/informe.xlsx`, `${ROOT}/sub/b.pdf`])
  })
  it('toma el destino de una redirección o -o del comando', () => {
    const r = detectDocFiles({ parts: [tool('bash', { command: 'pandoc a.md -o salida.docx && cat x.pdf' })], root: ROOT })
    expect(r).toEqual([`${ROOT}/salida.docx`])
  })
  it('no duplica la misma ruta mencionada de varias formas', () => {
    const r = detectDocFiles({
      parts: [tool('write', { filePath: 'a.pdf' }), text(`Listo: ${ROOT}/a.pdf`), tool('bash', { command: 'ls' }, './a.pdf')],
      root: ROOT
    })
    expect(r).toEqual([`${ROOT}/a.pdf`])
  })
  it('la ruta absoluta con espacios no genera además un relativo falso', () => {
    const r = detectDocFiles({ parts: [tool('bash', { command: 'x' }, 'Guardado en /tmp/Mis Docs/final.pdf')], root: ROOT })
    expect(r).toEqual(['/tmp/Mis Docs/final.pdf'])
  })
  it('un .html solo cuenta si parece una presentación o informe', () => {
    const r = detectDocFiles({
      parts: [tool('write', { filePath: 'index.html' }), tool('write', { filePath: 'presentacion-q3.html' })],
      root: ROOT
    })
    expect(r).toEqual([`${ROOT}/presentacion-q3.html`])
  })
  it('relativa sin proyecto se descarta', () => {
    expect(detectDocFiles({ parts: [tool('write', { filePath: 'a.pdf' })], root: null })).toEqual([])
  })
})

describe('normalizeAbs', () => {
  it('resuelve . y ..', () => {
    expect(normalizeAbs('/a/b/../c/./d.pdf')).toBe('/a/c/d.pdf')
  })
})
