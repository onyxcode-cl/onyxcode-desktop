import { beforeEach, describe, expect, it, vi } from 'vitest'
import { formatFileSize, getChatDocSize, recordChatDocSize, resetChatDocSizes, subscribeChatDocSize } from './chatDocSize'

describe('formatFileSize', () => {
  it('formatea B, KB y MB según el idioma', () => {
    expect(formatFileSize(512, 'es')).toBe('512 B')
    expect(formatFileSize(1024, 'es')).toBe('1 KB')
    expect(formatFileSize(124 * 1024 + 300, 'en')).toBe('124 KB')
    expect(formatFileSize(1.5 * 1024 * 1024, 'es')).toBe('1,5 MB')
    expect(formatFileSize(1.5 * 1024 * 1024, 'en')).toBe('1.5 MB')
  })
  it('valores inválidos dan cadena vacía (nunca «0 KB»)', () => {
    expect(formatFileSize(0, 'es')).toBe('')
    expect(formatFileSize(NaN, 'en')).toBe('')
    expect(formatFileSize(-3, 'en')).toBe('')
  })
})

describe('caché de peso por contenido', () => {
  beforeEach(() => resetChatDocSizes())
  it('guarda por tipo+contenido y no confunde documentos', () => {
    recordChatDocSize('xlsx', '{"a":1}', 2048)
    expect(getChatDocSize('xlsx', '{"a":1}')).toBe(2048)
    expect(getChatDocSize('xlsx', '{"a":2}')).toBeNull()
    expect(getChatDocSize('docx', '{"a":1}')).toBeNull()
  })
  it('ignora html y valores no válidos (no inventa números)', () => {
    recordChatDocSize('html', '<p>x</p>', 5000)
    recordChatDocSize('xlsx', 'a', undefined)
    recordChatDocSize('xlsx', 'b', -1)
    recordChatDocSize('xlsx', 'c', NaN)
    expect(getChatDocSize('html', '<p>x</p>')).toBeNull()
    expect(getChatDocSize('xlsx', 'a')).toBeNull()
    expect(getChatDocSize('xlsx', 'b')).toBeNull()
    expect(getChatDocSize('xlsx', 'c')).toBeNull()
  })
  it('avisa a los suscriptores solo si el dato cambia', () => {
    const cb = vi.fn()
    const off = subscribeChatDocSize(cb)
    recordChatDocSize('pptx', 'x', 100)
    recordChatDocSize('pptx', 'x', 100)
    expect(cb).toHaveBeenCalledTimes(1)
    off()
    recordChatDocSize('pptx', 'x', 200)
    expect(cb).toHaveBeenCalledTimes(1)
  })
})
