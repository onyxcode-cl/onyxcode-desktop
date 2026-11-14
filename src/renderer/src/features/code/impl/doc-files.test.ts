import { describe, expect, it } from 'vitest'
import type { Part } from '@opencode-ai/sdk/v2/client'
import { detectDocFiles, normalizeAbs } from './doc-files'

const ROOT = '/Users/ben/Proyecto con espacio'
const tool = (name: string, input: Record<string, unknown>, output = '', status = 'completed'): Part =>
  ({
    id: `${name}-${Math.random()}`,
    type: 'tool',
    tool: name,
    callID: 'c',
    state: { status, input, output }
  }) as unknown as Part
const text = (t: string): Part => ({ id: 't', type: 'text', text: t }) as unknown as Part

describe('detectDocFiles', () => {
  it('detecta la copia HTML autónoma solo tras preparación confirmada', () => {
    expect(
      detectDocFiles({
        parts: [tool('documentos_preparar_html', { ruta: 'deck.html' }, `Documento creado: ${ROOT}/deck-autonomo.html (20.1 KB).`)],
        root: ROOT
      })
    ).toEqual([`${ROOT}/deck-autonomo.html`])
    expect(
      detectDocFiles({ parts: [tool('documentos_preparar_html', { ruta: 'deck.html' }, 'La foto no está preparada')], root: ROOT })
    ).toEqual([])
  })
  it('detecta el PDF exportado solo cuando la herramienta confirma el archivo', () => {
    expect(
      detectDocFiles({
        parts: [tool('documentos_exportar_pdf', { ruta: 'Original.docx' }, `Documento creado: ${ROOT}/Original.pdf (20 KB).`)],
        root: ROOT
      })
    ).toEqual([`${ROOT}/Original.pdf`])
    expect(
      detectDocFiles({
        parts: [tool('documentos_exportar_pdf', { ruta: 'Original.docx' }, 'No se pudo convertir el documento.')],
        root: ROOT
      })
    ).toEqual([])
  })
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

describe('herramientas de documentos en Código', () => {
  it('crear usa la ruta efectiva del resultado, con subcarpeta, espacios y paréntesis', () => {
    const path = `${ROOT}/salida/Informe (2) ñ.docx`
    expect(
      detectDocFiles({
        parts: [tool('documentos_crear', { nombre: 'Informe' }, `Documento creado: ${path} (18 KB).\nRevisión: correcta`)],
        root: ROOT
      })
    ).toEqual([path])
  })

  it('renderizar usa ruta relativa a carpeta, también para archivos editados', () => {
    expect(
      detectDocFiles({
        parts: [
          tool('documentos_renderizar', { ruta: 'editados/convenio-v2.docx', carpeta: `${ROOT}/docs` }, 'Vista previa: 2 página(s).')
        ],
        root: ROOT
      })
    ).toEqual([`${ROOT}/docs/editados/convenio-v2.docx`])
  })

  it('las dos herramientas con prefijo MCP y rutas absolutas de Windows', () => {
    const root = String.raw`C:\Proyectos\Mi proyecto`
    const path = String.raw`C:\Proyectos\Mi proyecto\salida\Informe ñ (2).xlsx`
    expect(
      detectDocFiles({
        parts: [
          tool('documentos_documentos_crear', {}, `Documento creado: ${path} (2 KB).`),
          tool('lazunox_documentos_renderizar', { ruta: path }, 'Vista previa: 1 página(s) del libro impreso.')
        ],
        root
      })
    ).toEqual([path])
  })

  it('resuelve barras mixtas y ruta relativa de Windows contra carpeta, sin perder la unidad', () => {
    expect(
      detectDocFiles({
        parts: [
          tool(
            'documentos_renderizar',
            {
              ruta: String.raw`salida\Informe de ventas.xlsx`,
              carpeta: 'C:/Proyectos/Mi proyecto/docs'
            },
            'Vista previa: 1 página(s).'
          )
        ],
        root: String.raw`C:\Proyectos\Mi proyecto`
      })
    ).toEqual([String.raw`C:\Proyectos\Mi proyecto\docs\salida\Informe de ventas.xlsx`])
  })

  it('sin carpeta usa el proyecto y normaliza rutas de Windows', () => {
    expect(
      detectDocFiles({
        parts: [tool('documentos_renderizar', { ruta: String.raw`.\salida\..\final.pdf` }, 'Vista previa: 1 página(s).')],
        root: String.raw`D:\Proyecto`
      })
    ).toEqual([String.raw`D:\Proyecto\final.pdf`])
  })

  it('no convierte un intento ni un error MCP completado en documento', () => {
    const failed = tool('documentos_crear', {}, `Documento creado: ${ROOT}/fallo.pdf (1 KB).`, 'error')
    const running = tool('documentos_renderizar', { ruta: 'a.pdf' }, '', 'running')
    expect(
      detectDocFiles({
        parts: [
          failed,
          running,
          tool('documentos_crear', { nombre: 'a.pdf' }, 'No se pudo generar el documento.'),
          tool('documentos_renderizar', { ruta: 'a.pdf' }, 'No hay vista previa disponible.'),
          tool('otra_documentos_crear_falsa', {}, `Documento creado: ${ROOT}/a.pdf (1 KB).`)
        ],
        root: ROOT
      })
    ).toEqual([])
  })

  it('descarta NUL, tipos ajenos y rutas relativas sin carpeta', () => {
    expect(
      detectDocFiles({
        parts: [
          tool('documentos_crear', {}, `Documento creado: ${ROOT}/x.pdf\0 (1 KB).`),
          tool('documentos_renderizar', { ruta: `${ROOT}/programa.exe` }, 'Vista previa: 1 página(s).'),
          tool('documentos_renderizar', { ruta: 'a.pdf' }, 'Vista previa: 1 página(s).')
        ],
        root: null
      })
    ).toEqual([])
  })

  it('las rutas fuera del proyecto siguen siendo solo candidatas que main debe rechazar', () => {
    expect(
      detectDocFiles({
        parts: [tool('documentos_renderizar', { ruta: '../fuera/a.pdf' }, 'Vista previa: 1 página(s).')],
        root: '/proyecto'
      })
    ).toEqual(['/fuera/a.pdf'])
  })
})
