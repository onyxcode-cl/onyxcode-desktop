/**
 * Parsea el fragmento de la URL que abre la vista aislada del visor
 * (`#t=<token>&kind=pdf&lang=es&theme=dark`, ver `src/main/ipc/tasks-viewer-handlers.ts`).
 * Módulo PURO (sin DOM): recibe el string del fragmento, no `location.hash`.
 */
import type { DocKind } from '@shared/doc-kind'
import { isViewerLang, type ViewerLang } from './i18n'

export interface ViewerParams {
  token: string
  kind: DocKind
  lang: ViewerLang
  theme: 'light' | 'dark'
}

const KINDS: DocKind[] = ['pdf', 'docx', 'xlsx', 'pptx']

function isDocKind(v: string | null): v is DocKind {
  return !!v && (KINDS as string[]).includes(v)
}

/** `null` si falta algún campo o no se reconoce (nunca lanza). */
export function parseViewerParams(hash: string): ViewerParams | null {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash
  const params = new URLSearchParams(raw)
  const token = params.get('t')
  const kind = params.get('kind')
  const lang = params.get('lang')
  const theme = params.get('theme')
  if (!token || !/^[0-9a-f]{64}$/.test(token)) return null
  if (!isDocKind(kind)) return null
  if (!isViewerLang(lang)) return null
  if (theme !== 'light' && theme !== 'dark') return null
  return { token, kind, lang, theme }
}

/** URL del documento del token, dentro del mismo origen del visor. */
export function docUrl(token: string): string {
  return `/doc/${token}`
}
