import { describe, expect, it, vi } from 'vitest'
import type { ConversationExportRequest } from '@shared/ipc-extras'

vi.mock('electron', () => ({ app: { isPackaged: false, getPath: () => '/tmp' }, dialog: {} }))
const renderHtmlToPdf = vi.fn(async (_html: string, _title?: string) => Buffer.from('%PDF-1.4 falso'))
vi.mock('./artifact-window', () => ({ renderHtmlToPdf }))

const { buildExport, forceExtension } = await import('./export-conversation')

const req = (format: 'md' | 'pdf', title = 'Mi chat'): ConversationExportRequest => ({
  format,
  lang: 'es',
  options: { reasoning: false, tools: true, attachments: true },
  doc: {
    title,
    createdAt: 1_760_000_000_000,
    model: 'm',
    turns: [
      { role: 'user', at: 1_760_000_000_000, parts: [{ kind: 'text', text: 'clave sk-ant-api03-FALSA1234567890abcdefXYZ' }], files: [] }
    ]
  }
})

describe('buildExport', () => {
  it('Markdown: nombre saneado con .md y clave tachada', async () => {
    const out = await buildExport(req('md', '../../secreto.exe'))
    expect(out.ext).toBe('md')
    expect(out.fileName).toBe('secreto-exe.md')
    expect(String(out.data)).not.toContain('sk-ant')
    expect(out.redactions).toBe(1)
  })

  it('PDF: manda a imprimir un HTML sin scripts y con CSP estricta', async () => {
    const out = await buildExport(req('pdf', 'Informe'))
    expect(out.fileName).toBe('Informe.pdf')
    expect(Buffer.isBuffer(out.data)).toBe(true)
    const html = String(renderHtmlToPdf.mock.calls[0][0])
    expect(html).not.toMatch(/<script/i)
    expect(html).toContain("default-src 'none'")
    expect(html).not.toContain('sk-ant')
  })

  it('PDF: si el motor de impresión no devuelve un PDF, falla', async () => {
    renderHtmlToPdf.mockResolvedValueOnce(Buffer.from('nada'))
    await expect(buildExport(req('pdf'))).rejects.toThrow()
  })
})

describe('forceExtension', () => {
  it('añade la extensión si el diálogo devolvió otra', () => {
    expect(forceExtension('/tmp/a.exe', 'pdf')).toBe('/tmp/a.exe.pdf')
    expect(forceExtension('/tmp/a', 'md')).toBe('/tmp/a.md')
    expect(forceExtension('/tmp/a.MD', 'md')).toBe('/tmp/a.MD')
  })
})
