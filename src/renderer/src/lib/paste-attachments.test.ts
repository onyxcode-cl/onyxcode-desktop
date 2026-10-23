// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import {
  collectClipboardFiles,
  handlePaste,
  pasteFilesToFileObjects,
  pasteRejectedMessages,
  shouldTryFallback,
  type PasteData
} from './paste-attachments'

const file = (name: string, type: string): File => new File(['x'], name, { type })

function data(opts: { items?: File[]; files?: File[]; text?: string; types?: string[] }): PasteData {
  return {
    items: (opts.items ?? []).map((f) => ({ kind: 'file', type: f.type, getAsFile: () => f })),
    files: opts.files ?? [],
    types: opts.types ?? (opts.text ? ['text/plain'] : []),
    getData: (f) => (f === 'text/plain' ? (opts.text ?? '') : '')
  }
}
const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0))

describe('collectClipboardFiles', () => {
  it('items kind file; si no hay, files; vacío', () => {
    const a = file('a.png', 'image/png')
    expect(collectClipboardFiles(data({ items: [a] }), 'any')).toEqual([a])
    expect(collectClipboardFiles(data({ files: [a] }), 'any')).toEqual([a])
    expect(collectClipboardFiles(data({}), 'any')).toEqual([])
    expect(collectClipboardFiles(null, 'any')).toEqual([])
  })
  it('ámbito images descarta lo que no es imagen', () => {
    const d = data({ items: [file('a.pdf', 'application/pdf'), file('b.png', 'image/png')] })
    expect(collectClipboardFiles(d, 'images').map((f) => f.name)).toEqual(['b.png'])
  })
})

describe('shouldTryFallback', () => {
  it('sí: vacío o nombre corto de una línea; no: texto largo, multilínea o HTML', () => {
    expect(shouldTryFallback(data({}))).toBe(true)
    expect(shouldTryFallback(data({ text: 'informe.pdf' }))).toBe(true)
    expect(shouldTryFallback(data({ text: 'a\nb' }))).toBe(false)
    expect(shouldTryFallback(data({ text: 'x'.repeat(300) }))).toBe(false)
    expect(shouldTryFallback(data({ text: 'hola', types: ['text/plain', 'text/html'] }))).toBe(false)
  })
})

describe('handlePaste', () => {
  const ev = (cd: PasteData | null) => ({ clipboardData: cd, preventDefault: vi.fn() })

  it('vía estándar: cancela el pegado y añade los archivos sin llamar al respaldo', () => {
    const e = ev(data({ items: [file('a.png', 'image/png')] }))
    const addFiles = vi.fn()
    const readFallback = vi.fn()
    expect(handlePaste(e, { scope: 'any', addFiles, readFallback })).toBe(true)
    expect(e.preventDefault).toHaveBeenCalled()
    expect(addFiles).toHaveBeenCalledTimes(1)
    expect(readFallback).not.toHaveBeenCalled()
  })
  it('texto largo: no toca nada (pegado normal)', () => {
    const e = ev(data({ text: 'una\nlínea\nlarga' }))
    const readFallback = vi.fn()
    expect(handlePaste(e, { scope: 'any', addFiles: vi.fn(), readFallback })).toBe(false)
    expect(e.preventDefault).not.toHaveBeenCalled()
    expect(readFallback).not.toHaveBeenCalled()
  })
  it('sin fallback (celular): vacío no se toma', () => {
    const e = ev(data({}))
    expect(handlePaste(e, { scope: 'any', addFiles: vi.fn(), fallback: false })).toBe(false)
    expect(e.preventDefault).not.toHaveBeenCalled()
  })
  it('respaldo con archivos: los añade y no inserta el nombre como texto', async () => {
    const e = ev(data({ text: 'informe.pdf' }))
    const addFiles = vi.fn()
    const insertText = vi.fn()
    const f = file('informe.pdf', 'application/pdf')
    expect(handlePaste(e, { scope: 'any', addFiles, insertText, readFallback: async () => ({ files: [f], rejected: [] }) })).toBe(true)
    await flush()
    expect(addFiles).toHaveBeenCalledWith([f])
    expect(insertText).not.toHaveBeenCalled()
  })
  it('respaldo sin archivos: inserta el texto original', async () => {
    const e = ev(data({ text: 'hola' }))
    const insertText = vi.fn()
    handlePaste(e, { scope: 'any', addFiles: vi.fn(), insertText, readFallback: async () => ({ files: [], rejected: [] }) })
    await flush()
    expect(insertText).toHaveBeenCalledWith('hola')
  })
  it('respaldo que falla: inserta el texto', async () => {
    const insertText = vi.fn()
    handlePaste(ev(data({ text: 'hola' })), {
      scope: 'any',
      addFiles: vi.fn(),
      insertText,
      readFallback: () => Promise.reject(new Error('x'))
    })
    await flush()
    expect(insertText).toHaveBeenCalledWith('hola')
  })
  it('rechazos: avisa con mensajes traducidos y no inserta texto', async () => {
    const onErrors = vi.fn()
    const insertText = vi.fn()
    handlePaste(ev(data({ text: 'carpeta' })), {
      scope: 'any',
      addFiles: vi.fn(),
      onErrors,
      insertText,
      readFallback: async () => ({ files: [], rejected: [{ name: 'grande.zip', reason: 'tooBig' }] })
    })
    await flush()
    expect(onErrors.mock.calls[0]![0][0]).toContain('grande.zip')
    expect(insertText).not.toHaveBeenCalled()
  })
  it('Tareas: handled=true no inserta texto', async () => {
    const insertText = vi.fn()
    handlePaste(ev(data({})), {
      scope: 'any',
      addFiles: vi.fn(),
      insertText,
      readFallback: async () => ({ files: [], rejected: [], handled: true })
    })
    await flush()
    expect(insertText).not.toHaveBeenCalled()
  })
})

describe('conversión y mensajes', () => {
  it('base64 → File con nombre y tipo', async () => {
    const [f] = pasteFilesToFileObjects([{ name: 'a.png', mime: 'image/png', size: 3, base64: btoa('abc') }])
    expect(f!.name).toBe('a.png')
    expect(f!.type).toBe('image/png')
    expect(f!.size).toBe(3)
  })
  it('un mensaje por cada motivo', () => {
    const reasons = ['tooBig', 'tooMany', 'tooBigTotal', 'notRegular', 'blockedType', 'unreadable'] as const
    const msgs = pasteRejectedMessages(reasons.map((reason) => ({ name: 'x', reason })))
    expect(new Set(msgs).size).toBe(6)
  })
})
