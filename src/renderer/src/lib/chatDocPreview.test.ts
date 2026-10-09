import { afterEach, describe, expect, it } from 'vitest'
import { getCreatingDoc, getCreatingRawText, previewInChatDocPanel, setChatDocPreviewHandler, setCreatingDoc } from './chatDocPreview'

describe('chatDocPreview: registro del panel de "vista previa" del chat', () => {
  afterEach(() => setChatDocPreviewHandler(null))

  it('sin nadie registrado (Tareas, Code…): no hace nada y avisa que no había panel', () => {
    expect(previewInChatDocPanel('html', '<p>hola</p>', 'Título')).toBe(false)
  })

  it('con el chat montado: llama al handler registrado y avisa que sí había panel', () => {
    const calls: Array<[string, string, string]> = []
    setChatDocPreviewHandler((kind, rawText, title) => calls.push([kind, rawText, title]))
    expect(previewInChatDocPanel('html', '<p>hola</p>', 'Título')).toBe(true)
    expect(calls).toEqual([['html', '<p>hola</p>', 'Título']])
  })

  it('funciona igual para xlsx/pptx, no solo html', () => {
    const calls: Array<[string, string, string]> = []
    setChatDocPreviewHandler((kind, rawText, title) => calls.push([kind, rawText, title]))
    expect(previewInChatDocPanel('xlsx', '{"sheets":[]}', 'Gastos')).toBe(true)
    expect(calls).toEqual([['xlsx', '{"sheets":[]}', 'Gastos']])
  })

  it('al desmontar el chat (handler null): vuelve a no hacer nada', () => {
    setChatDocPreviewHandler(() => {
      throw new Error('no debería llamarse')
    })
    setChatDocPreviewHandler(null)
    expect(previewInChatDocPanel('html', '<p>hola</p>', 'Título')).toBe(false)
  })
})

describe('chatDocPreview: qué documento se está generando (HUD de progreso + CodeBlock)', () => {
  afterEach(() => setCreatingDoc(null))

  it('nada generándose: ambos lectores dan null', () => {
    expect(getCreatingRawText()).toBeNull()
    expect(getCreatingDoc()).toBeNull()
  })

  it('al marcar un documento: getCreatingRawText da el texto y getCreatingDoc trae tipo + título + hora de inicio', () => {
    const before = Date.now()
    setCreatingDoc({ kind: 'html', rawText: '<p>cotización</p>', title: 'Cotización Pinturas del Sur' })
    const doc = getCreatingDoc()
    expect(getCreatingRawText()).toBe('<p>cotización</p>')
    expect(doc?.kind).toBe('html')
    expect(doc?.title).toBe('Cotización Pinturas del Sur')
    expect(doc?.startedAt).toBeGreaterThanOrEqual(before)
  })

  it('al limpiar (null): ambos lectores vuelven a null', () => {
    setCreatingDoc({ kind: 'xlsx', rawText: '{"sheets":[]}', title: 'X' })
    setCreatingDoc(null)
    expect(getCreatingRawText()).toBeNull()
    expect(getCreatingDoc()).toBeNull()
  })
})
