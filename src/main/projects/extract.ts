/**
 * Texto de un archivo de conocimiento de un proyecto (F8-B185). Módulo sin Electron.
 *  - Texto y Markdown: se decodifica como UTF-8 (un archivo binario se rechaza).
 *  - Word, Excel, PowerPoint, OpenDocument y RTF: el mismo lector de solo lectura del adjunto del Chat (`office-extract`).
 *  - PDF: texto con pdf.js en el propio proceso, sin abrir ni ejecutar nada del archivo (scripts del PDF desactivados), con tope de
 *    páginas, de caracteres y de tiempo. Un PDF que es solo imagen (sin texto) se informa como «no se pudo leer».
 * Todo corre en el equipo: nada se envía a ningún servicio.
 */
import type { ProjectFileFailReason } from '@shared/ipc-extras'
import { knowledgeKind, PROJECT_LIMITS } from '@shared/project-knowledge'
import { extractOfficeBody } from '../files/office-extract'

export type KnowledgeText = { ok: true; text: string; truncated: boolean } | { ok: false; reason: ProjectFileFailReason }

const PDF_MAX_PAGES = 400
const PDF_TIMEOUT_MS = 60_000

function limit(text: string): { text: string; truncated: boolean } {
  const max = PROJECT_LIMITS.maxCharsPerFile
  return text.length > max ? { text: text.slice(0, max), truncated: true } : { text, truncated: false }
}

interface PdfTextItem {
  str?: string
  hasEOL?: boolean
}
interface PdfPage {
  getTextContent(): Promise<{ items: PdfTextItem[] }>
  cleanup?: () => void
}
interface PdfDoc {
  numPages: number
  getPage(n: number): Promise<PdfPage>
}
interface PdfJs {
  getDocument(src: Record<string, unknown>): { promise: Promise<PdfDoc>; destroy?: () => Promise<void> }
}

async function loadPdfJs(): Promise<PdfJs> {
  // Compilación para Node de pdf.js; se importa solo al leer un PDF (no pesa en el arranque).
  const mod = (await import('pdfjs-dist/legacy/build/pdf.mjs')) as unknown as PdfJs
  return mod
}

async function pdfText(buf: Buffer): Promise<KnowledgeText> {
  let pdfjs: PdfJs
  try {
    pdfjs = await loadPdfJs()
  } catch {
    return { ok: false, reason: 'unreadable' }
  }
  const task = pdfjs.getDocument({
    data: new Uint8Array(buf),
    isEvalSupported: false,
    enableXfa: false,
    useSystemFonts: false,
    disableFontFace: true,
    verbosity: 0
  })
  const work = (async (): Promise<KnowledgeText> => {
    let doc: PdfDoc
    try {
      doc = await task.promise
    } catch (e) {
      const name = (e as { name?: string } | null)?.name
      return { ok: false, reason: name === 'PasswordException' ? 'encrypted' : 'corrupt' }
    }
    try {
      const pages: string[] = []
      let chars = 0
      let truncated = doc.numPages > PDF_MAX_PAGES
      for (let n = 1; n <= Math.min(doc.numPages, PDF_MAX_PAGES); n++) {
        const page = await doc.getPage(n)
        const content = await page.getTextContent()
        let line = ''
        let out = ''
        for (const it of content.items) {
          line += it.str ?? ''
          if (it.hasEOL) {
            out += line.trim() + '\n'
            line = ''
          } else if (it.str && !/\s$/.test(it.str)) line += ' '
        }
        out += line.trim()
        page.cleanup?.()
        if (out.trim()) pages.push(out.trim())
        chars += out.length
        if (chars > PROJECT_LIMITS.maxCharsPerFile) {
          truncated = true
          break
        }
      }
      const joined = pages.join('\n\n')
      if (!joined.trim()) return { ok: false, reason: 'noText' }
      const l = limit(joined)
      return { ok: true, text: l.text, truncated: truncated || l.truncated }
    } catch {
      return { ok: false, reason: 'corrupt' }
    }
  })()
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<KnowledgeText>((resolve) => {
    timer = setTimeout(() => resolve({ ok: false, reason: 'unreadable' }), PDF_TIMEOUT_MS)
  })
  try {
    return await Promise.race([work, timeout])
  } finally {
    if (timer) clearTimeout(timer)
    void task.destroy?.().catch(() => undefined)
  }
}

/** Convierte los bytes de un archivo en texto plano indexable. Nunca lanza. */
export async function extractKnowledgeText(name: string, buf: Buffer): Promise<KnowledgeText> {
  const kind = knowledgeKind(name)
  if (!kind) return { ok: false, reason: 'unsupported' }
  if (buf.length === 0) return { ok: false, reason: 'empty' }
  try {
    if (kind === 'text') {
      if (buf.subarray(0, 8192).includes(0)) return { ok: false, reason: 'unreadable' }
      const text = buf.toString('utf8').replace(/^﻿/, '')
      if (!text.trim()) return { ok: false, reason: 'empty' }
      return { ok: true, ...limit(text) }
    }
    if (kind === 'office') {
      const r = await extractOfficeBody({ name, base64: buf.toString('base64') })
      if (!r.ok) {
        const reason = r.reason === 'tooBig' ? 'tooBig' : r.reason === 'unsupported' ? 'unsupported' : r.reason
        return { ok: false, reason }
      }
      return { ok: true, text: r.body, truncated: r.notes.length > 0 }
    }
    return await pdfText(buf)
  } catch {
    return { ok: false, reason: 'unreadable' }
  }
}
