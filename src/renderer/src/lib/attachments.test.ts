import { describe, expect, it } from 'vitest'
import {
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
    for (const x of [f('a.exe', 'application/x-msdownload'), f('a.zip', 'application/zip'), f('a.svg', 'image/svg+xml'), f('a', ''), f('a.bin', 'application/octet-stream')])
      expect(classifyFile(x)).toBeNull()
  })
})

describe('validateFiles', () => {
  it('acepta lo válido y devuelve un mensaje por cada rechazo', () => {
    const r = validateFiles([f('a.png', 'image/png'), f('b.exe', 'application/x-msdownload'), f('c.png', 'image/png', MAX_IMAGE_BYTES + 1), f('d.txt', 'text/plain', MAX_TEXT_BYTES + 1)], { count: 0, bytes: 0 })
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
