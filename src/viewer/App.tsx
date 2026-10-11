/**
 * Vista aislada del visor: un componente real por tipo (PDF.js, docx-preview, SheetJS, vista
 * estructural de PowerPoint). Ninguno de estos formatos se puede confiar: cada uno vive detrás de
 * las mismas capas (esquema propio, sesión sin red saliente, CSP estricta) que documenta
 * `docs/SEGURIDAD.md`.
 */
import { useEffect, useState } from 'react'
import { parseViewerParams, type ViewerParams } from './params'
import { PdfViewer } from './pdf/PdfViewer'
import { DocxViewer } from './docx/DocxViewer'
import { XlsxViewer } from './xlsx/XlsxViewer'
import { PptxViewer } from './pptx/PptxViewer'
import { tv } from './i18n'

function readParams(): ViewerParams | null {
  try {
    return parseViewerParams(location.hash)
  } catch {
    return null
  }
}

export function App(): React.JSX.Element {
  const [params] = useState<ViewerParams | null>(readParams)

  useEffect(() => {
    if (!params) return
    document.documentElement.dataset.theme = params.theme
    document.documentElement.lang = params.lang
    // El tema de la dirección es el de cuando se abrió. Si la persona lo cambia con el visor abierto, main fija `nativeTheme.themeSource`
    // y `prefers-color-scheme` se actualiza aquí: se sigue en vivo (antes el visor se quedaba con el tema viejo).
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const follow = (): void => {
      document.documentElement.dataset.theme = mq.matches ? 'dark' : 'light'
    }
    mq.addEventListener('change', follow)
    return () => mq.removeEventListener('change', follow)
  }, [params])

  if (!params) return <ErrorView lang="es" />

  const { kind, lang, token } = params
  if (kind === 'pdf') return <PdfViewer token={token} lang={lang} />
  if (kind === 'docx') return <DocxViewer token={token} lang={lang} />
  if (kind === 'xlsx') return <XlsxViewer token={token} lang={lang} />
  return <PptxViewer token={token} lang={lang} />
}

function ErrorView({ lang }: { lang: 'es' | 'en' }): React.JSX.Element {
  return (
    <div className="viewer-center">
      <p>{tv(lang, 'errorTitle')}</p>
      <p className="viewer-muted">{tv(lang, 'errorBody')}</p>
    </div>
  )
}
