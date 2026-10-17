import { beforeEach, describe, expect, it, vi } from 'vitest'

// Sin `vi.fn`: vitest engancha las promesas que devuelve un mock y una que rechaza a propósito contaría como fallo suelto.
const h = vi.hoisted(() => ({ impl: (..._a: unknown[]): Promise<unknown> => Promise.resolve(null), calls: [] as unknown[][] }))
vi.mock('./api', () => ({
  call: (...a: unknown[]) => {
    h.calls.push(a)
    return h.impl(...a)
  }
}))
const callMock = {
  reset: (): void => void (h.calls.length = 0),
  resolve: (v: unknown): void => void (h.impl = () => Promise.resolve(v)),
  reject: (e: Error): void => void (h.impl = () => Promise.reject(e))
}

import {
  officeCardLabel,
  officeFailMessage,
  textToDataUrl,
  toChatAttachment,
  attachmentBytes,
  classifyFile,
  isSafeAttachmentUrl,
  MAX_ATTACHMENTS,
  MAX_IMAGE_BYTES,
  MAX_TEXT_BYTES,
  MAX_TOTAL_BYTES,
  validateFiles
} from './attachments'

const f = (name: string, type: string, size = 100): { name: string; type: string; size: number } => ({ name, type, size })

describe('classifyFile', () => {
  it('admite imágenes, PDF y texto; normaliza el texto a text/plain', () => {
    expect(classifyFile(f('a.png', 'image/png'))?.kind).toBe('image')
    expect(classifyFile(f('a.pdf', 'application/pdf'))?.kind).toBe('pdf')
    expect(classifyFile(f('a.md', 'text/markdown'))).toMatchObject({ kind: 'text', mime: 'text/plain' })
    expect(classifyFile(f('a.ts', ''))).toMatchObject({ kind: 'text', mime: 'text/plain' })
    expect(classifyFile(f('a.json', 'application/json'))?.mime).toBe('text/plain')
  })
  it('rechaza ejecutables, zips, SVG y binarios sin tipo', () => {
    for (const x of [
      f('a.exe', 'application/x-msdownload'),
      f('a.zip', 'application/zip'),
      f('a.svg', 'image/svg+xml'),
      f('a', ''),
      f('a.bin', 'application/octet-stream')
    ])
      expect(classifyFile(x)).toBeNull()
  })
})

describe('validateFiles', () => {
  it('acepta lo válido y devuelve un mensaje por cada rechazo', () => {
    const r = validateFiles(
      [
        f('a.png', 'image/png'),
        f('b.exe', 'application/x-msdownload'),
        f('c.png', 'image/png', MAX_IMAGE_BYTES + 1),
        f('d.txt', 'text/plain', MAX_TEXT_BYTES + 1)
      ],
      { count: 0, bytes: 0 }
    )
    expect(r.accepted).toEqual([0])
    expect(r.errors).toHaveLength(3)
  })
  it('respeta el máximo de adjuntos y el tamaño total', () => {
    const many = Array.from({ length: MAX_ATTACHMENTS + 2 }, (_, i) => f(`${i}.png`, 'image/png'))
    expect(validateFiles(many, { count: 0, bytes: 0 }).accepted).toHaveLength(MAX_ATTACHMENTS)
    expect(validateFiles([f('a.png', 'image/png', 1000)], { count: 1, bytes: MAX_TOTAL_BYTES }).accepted).toEqual([])
  })
})

describe('urls', () => {
  it('solo data: es seguro', () => {
    expect(isSafeAttachmentUrl('data:image/png;base64,AAAA')).toBe(true)
    expect(isSafeAttachmentUrl('file:///etc/passwd')).toBe(false)
    expect(isSafeAttachmentUrl('https://x/y.png')).toBe(false)
  })
  it('attachmentBytes estima por exceso el tamaño base64', () => {
    expect(attachmentBytes({ url: 'data:text/plain;base64,aG9sYQ==' })).toBe(6)
  })
})

describe('documentos de oficina', () => {
  beforeEach(() => callMock.reset())

  it('se reconocen por la extensión aunque el sistema no dé tipo (o dé uno genérico) y viajan como texto', () => {
    for (const n of [
      'a.docx',
      'a.DOCX',
      'b.xlsx',
      'c.xls',
      'd.pptx',
      'e.odt',
      'f.ods',
      'g.odp',
      'h.rtf',
      'i.docm',
      'j.xlsm',
      'k.doc',
      'l.ppt'
    ]) {
      expect(classifyFile(f(n, ''))).toMatchObject({ kind: 'office', mime: 'text/plain' })
      expect(classifyFile(f(n, 'application/octet-stream'))?.kind).toBe('office')
    }
    expect(classifyFile(f('x.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'))?.kind).toBe('office')
    // El CSV sigue siendo texto plano (no pasa por la conversión).
    expect(classifyFile(f('a.csv', 'text/csv'))?.kind).toBe('text')
    expect(classifyFile(f('a.pages', ''))).toBeNull()
  })

  it('validateFiles aplica el tope de 10 MB a los documentos', () => {
    const r = validateFiles([f('a.docx', '', 11 * 1024 * 1024), f('b.xlsx', '', 1024)], { count: 0, bytes: 0 })
    expect(r.accepted).toEqual([1])
    expect(r.errors).toHaveLength(1)
  })

  it('toChatAttachment manda los bytes a main y adjunta el texto devuelto como data:text/plain', async () => {
    callMock.resolve({
      ok: true,
      text: 'Archivo adjunto: «a.docx»\n# Título con ñ y 🙂',
      family: 'document',
      units: 3,
      unit: 'pages',
      truncated: false,
      notes: []
    })
    const file = new File([new Uint8Array([80, 75, 3, 4])], 'a.docx')
    const att = await toChatAttachment(file)
    expect(h.calls).toEqual([['attach:extractOffice', { name: 'a.docx', base64: 'UEsDBA==' }]])
    expect(att.mime).toBe('text/plain')
    expect(att.name).toBe('a.docx')
    expect(att.office).toMatchObject({ family: 'document', units: 3, unit: 'pages' })
    expect(isSafeAttachmentUrl(att.url)).toBe(true)
    const b64 = att.url.split(',')[1]
    expect(new TextDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)))).toBe(
      'Archivo adjunto: «a.docx»\n# Título con ñ y 🙂'
    )
  })

  it('un documento ilegible lanza un mensaje claro (contraseña, formato antiguo, dañado)', async () => {
    callMock.resolve({ ok: false, reason: 'encrypted' })
    await expect(toChatAttachment(new File([new Uint8Array(4)], 'secreto.xlsx'))).rejects.toThrow(/protegido con contraseña/)
    callMock.resolve({ ok: false, reason: 'legacy' })
    await expect(toChatAttachment(new File([new Uint8Array(4)], 'viejo.doc'))).rejects.toThrow(/formato antiguo/)
    callMock.reject(new Error('IPC roto'))
    await expect(toChatAttachment(new File([new Uint8Array(4)], 'x.pptx'))).rejects.toThrow(/no se pudo leer/)
    expect(officeFailMessage('corrupt', 'z.docx')).toContain('z.docx')
  })

  it('textToDataUrl conserva UTF-8 y la tarjeta resume tipo, cantidad y recorte', () => {
    expect(textToDataUrl('añ')).toBe('data:text/plain;base64,YcOx')
    expect(officeCardLabel({ family: 'spreadsheet', unit: 'sheets', units: 1, truncated: false, notes: [] })).toBe(
      'hoja de cálculo · 1 hoja'
    )
    expect(officeCardLabel({ family: 'presentation', unit: 'slides', units: 12, truncated: true, notes: ['x'] })).toBe(
      'presentación · 12 diapositivas · recortado'
    )
    expect(officeCardLabel({ family: 'document', unit: 'pages', units: null, truncated: false, notes: [] })).toBe('documento de texto')
  })
})
