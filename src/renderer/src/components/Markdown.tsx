import {
  createContext,
  isValidElement,
  memo,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode
} from 'react'
import type { Element } from 'hast'
import { ChevronRight, Loader2 } from 'lucide-react'
import ReactMarkdown, { type Components, type Options } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { t } from '@shared/i18n'
import { CopyButton } from './CopyButton'
import { useHighlightPlugins } from './highlight-plugins'
import {
  ArtifactButton,
  DownloadPdfButton,
  DownloadSlidesPptxButton,
  PresentSlidesButton,
  guessTitle,
  looksRenderable
} from './artifacts/ArtifactButton'
import { DownloadDataDocButton, PreviewDataDocButton } from './artifacts/DataDocButton'
import { DocNotice, type DocProblemReason } from './artifacts/DocNotice'
import { askAboutChatDoc, canAskAboutChatDoc, getCreatingRawText, subscribeCreatingDoc, type ChatDocBlockKind } from '../lib/chatDocPreview'
import { guessDataTitle, isJsonLang, parseDataBlockDetailed, sniffDataKind } from '../lib/chatDocBlocks'
import { docProblemMessage, reportDocProblem } from '../lib/report-problems'
import '../app/mobile/markdown.css'

function noCreatingDoc(): null {
  return null
}

/** Texto fuente que está analizando el `<ReactMarkdown>` que envuelve a `CodeBlock` (ver `isFenceOpen`). */
const SourceTextContext = createContext('')

/**
 * ¿La respuesta que se está pintando sigue llegando? `true` = en curso, `false` = ya terminó, `undefined` = no se sabe (Tareas/Code no
 * lo informan). Solo con `false` una valla de documento sin cerrar se declara «cortada»: con `undefined` se sigue mostrando «Generando…».
 */
const StreamingContext = createContext<boolean | undefined>(undefined)

/**
 * ¿La valla de código de este fragmento (el texto fuente completo entre `node.position.start/end`
 * del `<pre>`) sigue ABIERTA? CommonMark extiende una valla sin cerrar hasta el final de lo recibido
 * hasta ahora, así que react-markdown ya pinta el bloque como "completo" (con sus botones) mucho
 * antes de que la valla realmente cierre — por eso el código no alcanza con mirar `renderable`. Se
 * busca desde abajo la última línea no vacía (saltando la propia línea de apertura, que trae el
 * lenguaje y por eso nunca puede confundirse con una de cierre) y se fija si es una de cierre real
 * (solo los backtick/tilde, sin nada más).
 */
export function isFenceOpen(slice: string): boolean {
  const lines = slice.split('\n')
  for (let i = lines.length - 1; i >= 1; i--) {
    if (lines[i].trim() === '') continue
    return !/^[ \t]*(`{3,}|~{3,})[ \t]*$/.test(lines[i])
  }
  return true
}

/**
 * `code` viene de recorrer los hijos ya parseados por react-markdown, que puede no coincidir
 * carácter a carácter con el fragmento crudo que extrajo `extractChatDocBlocks` — por eso se compara
 * recortando espacios en los extremos en vez de con igualdad estricta. Exportada aparte porque
 * `useSyncExternalStore` (SSR vs. cliente) hace que esta rama sea imposible de probar con
 * `renderToStaticMarkup`; esto sí se puede probar como función pura.
 */
export function isSameDoc(creatingRawText: string | null, code: string): boolean {
  return creatingRawText !== null && creatingRawText.trim() === code.trim()
}

function textOf(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textOf).join('')
  if (node && typeof node === 'object' && 'props' in node) {
    return textOf((node.props as { children?: ReactNode }).children)
  }
  return ''
}

const LANG_LABELS: Record<string, string> = {
  js: 'JavaScript',
  javascript: 'JavaScript',
  jsx: 'JSX',
  ts: 'TypeScript',
  typescript: 'TypeScript',
  tsx: 'TSX',
  py: 'Python',
  python: 'Python',
  sh: 'Shell',
  bash: 'Bash',
  zsh: 'Zsh',
  shell: 'Shell',
  json: 'JSON',
  yaml: 'YAML',
  yml: 'YAML',
  html: 'HTML',
  xlsx: 'Excel',
  pptx: 'PowerPoint',
  xml: 'XML',
  css: 'CSS',
  sql: 'SQL',
  md: 'Markdown',
  markdown: 'Markdown',
  rust: 'Rust',
  rs: 'Rust',
  go: 'Go',
  java: 'Java',
  kotlin: 'Kotlin',
  swift: 'Swift',
  c: 'C',
  cpp: 'C++',
  csharp: 'C#',
  cs: 'C#',
  php: 'PHP',
  ruby: 'Ruby',
  rb: 'Ruby',
  diff: 'Diff',
  dockerfile: 'Dockerfile'
}

/** Id crudo del lenguaje de la valla (p.ej. "html", "xlsx"), tal cual lo escribió el agente — sin mapear a un nombre lindo. */
function rawLanguageOf(children: ReactNode): string | null {
  const child = Array.isArray(children) ? children[0] : children
  if (!isValidElement(child)) return null
  const cls = (child.props as { className?: string }).className ?? ''
  const m = /language-([\w+#-]+)/.exec(cls)
  return m ? m[1].toLowerCase() : null
}

function languageOf(children: ReactNode): string | null {
  const id = rawLanguageOf(children)
  if (!id) return null
  if (id === 'plaintext' || id === 'text') return t('common.plainText')
  if (id === 'slides') return t('chat.doc.slides')
  return LANG_LABELS[id] ?? id
}

function CodeBlock({ children, node }: { children?: ReactNode; node?: Element }): React.JSX.Element {
  const rawLang = rawLanguageOf(children)
  const lang = languageOf(children)
  const code = textOf(children)
  // Un bloque marcado como HTML (o ```slides, un deck con paginación en CSS propia — ver el prompt
  // del agente de Chat — mismo camino que HTML de ahí en adelante) se ofrece siempre que tenga alguna
  // etiqueta (p.ej. un <button>); uno marcado ```xlsx/```pptx se ofrece siempre — a diferencia de
  // HTML, esos lenguajes de valla no se usan nunca para otra cosa, así que no hace falta ninguna
  // heurística de "¿tiene pinta de...?".
  const isSlides = rawLang === 'slides'
  // Un modelo a veces pega la spec en una valla ```json (o javascript/text): si el contenido es, sin dudas, la spec de un documento, cuenta como tal.
  const sniffedKind = useMemo(() => (isJsonLang(rawLang) ? sniffDataKind(code) : null), [rawLang, code])
  const docKind: ChatDocBlockKind | null =
    rawLang === 'xlsx'
      ? 'xlsx'
      : rawLang === 'pptx'
        ? 'pptx'
        : rawLang === 'docx'
          ? 'docx'
          : sniffedKind
            ? sniffedKind
            : (rawLang === 'html' || isSlides) && (looksRenderable(code) || /<[a-z]/i.test(code))
              ? 'html'
              : null
  const renderable = docKind !== null
  // Un documento (lo que arma un PDF/Excel/PowerPoint) es contenido a mostrar, no código a leer: se
  // oculta por defecto (igual que Claude no muestra el código fuente del artifact en el chat) y
  // queda un botón para quien sí quiera verlo o copiarlo.
  const [showCode, setShowCode] = useState(!renderable)
  // Mientras el bloque todavía se está escribiendo, `renderable` puede empezar en `false` (recién
  // abrió la valla ```html, todavía no hay ninguna etiqueta) y recién pasar a `true` unos caracteres
  // después — pero el `useState` de arriba solo lee su valor inicial UNA vez, al montar. Sin esto, un
  // bloque que arrancó "no renderable" se queda mostrando el código entero para siempre, aunque
  // termine siendo un documento completo. Si la persona ya tocó el botón, se respeta su elección.
  const wasRenderableRef = useRef(renderable)
  const userToggledRef = useRef(false)
  useEffect(() => {
    if (renderable && !wasRenderableRef.current && !userToggledRef.current) setShowCode(false)
    wasRenderableRef.current = renderable
  }, [renderable])
  // CommonMark extiende una valla sin cerrar hasta el final de lo recibido hasta ahora: react-markdown
  // ya pinta el bloque como "completo" (con sus botones) mucho antes de que la valla realmente
  // cierre, así que ver el código crudo apenas aparece la primera etiqueta hacía pensar que el
  // documento YA estaba listo. Mientras la valla sigue abierta (`fenceOpen`), se muestra "Generando
  // documento…"; cuando cierra, toma la posta `isSameDoc` (la generación del archivo real en curso
  // en el panel de Chat) hasta que el documento está listo — sin hueco entre una señal y la otra.
  const sourceText = useContext(SourceTextContext)
  const fenceOpen = useMemo(() => {
    const pos = node?.position
    if (!pos || pos.start.offset == null || pos.end.offset == null) return false
    return isFenceOpen(sourceText.slice(pos.start.offset, pos.end.offset))
  }, [node, sourceText])
  const creatingRawText = useSyncExternalStore(subscribeCreatingDoc, getCreatingRawText, noCreatingDoc)
  const streaming = useContext(StreamingContext)
  // Valla cerrada de un documento de datos cuyo contenido no se pudo leer: se avisa en vez de dejar un bloque que no hace nada.
  const isDataDoc = docKind === 'xlsx' || docKind === 'pptx' || docKind === 'docx'
  const brokenReason = useMemo<DocProblemReason | null>(() => {
    if (!isDataDoc || fenceOpen) return null
    const r = parseDataBlockDetailed(docKind, code)
    return r.ok ? null : r.reason
  }, [isDataDoc, fenceOpen, docKind, code])
  // Valla abierta cuando la respuesta ya terminó: el modelo se cortó (límite de salida, red…); «Generando…» sería eterno.
  const cut = renderable && fenceOpen && streaming === false
  const problem: DocProblemReason | null = cut ? 'cut' : brokenReason
  useEffect(() => {
    if (problem)
      reportDocProblem(code, docProblemMessage(docKind ?? 'html', problem === 'cut' ? 'cut' : problem === 'json' ? 'json' : 'schema'))
  }, [problem, code, docKind])
  if (problem) {
    const canAsk = canAskAboutChatDoc()
    const ask = (): void => {
      if (problem === 'cut') askAboutChatDoc(t('chat.doc.continuePrompt'))
      else
        askAboutChatDoc(t('chat.doc.retryPrompt', { reason: t(problem === 'json' ? 'chat.doc.problem.json' : 'chat.doc.problem.schema') }))
    }
    return (
      <div className="code-block">
        <DocNotice
          reason={problem}
          actionLabel={canAsk ? t(problem === 'cut' ? 'chat.doc.continue' : 'chat.doc.askAgain') : undefined}
          onAction={canAsk ? ask : undefined}
          detail={code.slice(0, 4000)}
        />
      </div>
    )
  }
  if (renderable && (fenceOpen || isSameDoc(creatingRawText, code))) {
    return (
      <div className="code-block">
        <div className="code-block-header">
          <span className="flex flex-1 items-center gap-1.5 truncate font-medium text-muted">
            <Loader2 size={12} className="shrink-0 animate-spin" />
            {t('chat.doc.creating')}
          </span>
        </div>
      </div>
    )
  }
  return (
    <div className="code-block">
      <div className="code-block-header">
        {renderable && (
          <button
            type="button"
            onClick={() => {
              userToggledRef.current = true
              setShowCode((v) => !v)
            }}
            className="flex min-w-0 flex-1 items-center gap-1 truncate text-left font-medium"
            aria-expanded={showCode}
          >
            <ChevronRight size={12} className={`shrink-0 transition-transform ${showCode ? 'rotate-90' : ''}`} />
            <span className="truncate">{lang ?? t('common.code')}</span>
          </button>
        )}
        {!renderable && <span className="flex-1 truncate font-medium">{lang ?? t('common.code')}</span>}
        {docKind === 'html' && (
          <>
            <ArtifactButton
              html={code}
              title={guessTitle(code, 1, isSlides ? t('chat.doc.slides') : t('chat.doc.preview'))}
              isSlides={isSlides}
              className="py-0.5 text-[11.5px]"
            />
            <DownloadPdfButton
              html={code}
              title={guessTitle(code, 1, isSlides ? t('chat.doc.slides') : t('chat.doc.preview'))}
              compact
              className="py-0.5 text-[11.5px]"
            />
            {isSlides && (
              <>
                <PresentSlidesButton
                  html={code}
                  title={guessTitle(code, 1, t('chat.doc.slides'))}
                  compact
                  className="py-0.5 text-[11.5px]"
                />
                <DownloadSlidesPptxButton
                  html={code}
                  title={guessTitle(code, 1, t('chat.doc.slides'))}
                  compact
                  className="py-0.5 text-[11.5px]"
                />
              </>
            )}
          </>
        )}
        {(docKind === 'xlsx' || docKind === 'pptx' || docKind === 'docx') && (
          <>
            <PreviewDataDocButton kind={docKind} rawText={code} title={guessDataTitle(docKind, code)} className="py-0.5 text-[11.5px]" />
            <DownloadDataDocButton
              kind={docKind}
              rawText={code}
              title={guessDataTitle(docKind, code)}
              compact
              className="py-0.5 text-[11.5px]"
            />
          </>
        )}
        <CopyButton text={() => textOf(children)} showLabel size={12} className="text-[11.5px]" />
      </div>
      {showCode && <pre>{children}</pre>}
    </div>
  )
}

const components: Components = {
  pre: ({ children, node }) => <CodeBlock node={node}>{children}</CodeBlock>,
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noreferrer">
      {children}
    </a>
  )
}

export { CopyButton }
/** Pide la carga del resaltado (en la PWA es un trozo aparte; en el escritorio no hace nada). */
export { preloadHighlight } from './highlight-plugins'

type PluggableList = NonNullable<Options['rehypePlugins']>

export const markdownComponents = components
export const markdownRemarkPlugins = [remarkGfm]
const NO_REHYPE: never[] = []

/**
 * F8-B65: divide el texto en bloques de nivel superior (corta en líneas en blanco FUERA de vallas de código y solo si lo
 * que sigue no continúa el bloque: sangrado o elemento de lista). Es conservador a propósito: ante la duda no corta.
 * Devuelve `null` (analizar entero, como siempre) si hay definiciones de referencia, notas al pie o HTML, que dependen del
 * documento completo.
 */
export function splitMarkdownBlocks(text: string): string[] | null {
  if (!text.includes('\n\n')) return null
  if (/^[ ]{0,3}\[[^\]]+\]:/m.test(text) || text.includes('[^') || /^\s*</m.test(text)) return null
  const lines = text.split('\n')
  const blocks: string[] = []
  let cur: string[] = []
  let fence: { ch: string; len: number } | null = null
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const f = /^\s*(`{3,}|~{3,})/.exec(line)
    if (f) {
      if (!fence) fence = { ch: f[1][0], len: f[1].length }
      else if (f[1][0] === fence.ch && f[1].length >= fence.len && /^\s*(`+|~+)\s*$/.test(line)) fence = null
    }
    cur.push(line)
    if (fence || line.trim() !== '') continue
    // Línea en blanco fuera de valla: ¿hay un bloque nuevo después?
    let j = i + 1
    while (j < lines.length && lines[j].trim() === '') j++
    if (j >= lines.length) continue // blanco final: aún no se sabe qué viene
    const next = lines[j]
    if (/^\s{2,}|^\t/.test(next) || /^\s*([-*+]|\d+[.)])(\s|$)/.test(next)) continue
    const block = cur.join('\n').trimEnd()
    if (block) blocks.push(block)
    cur = []
  }
  const last = cur.join('\n')
  if (last.trim()) blocks.push(last)
  return blocks.length > 1 ? blocks : null
}

const Block = memo(function Block({ text, rehype }: { text: string; rehype: PluggableList }): React.JSX.Element {
  return (
    <SourceTextContext.Provider value={text}>
      <ReactMarkdown remarkPlugins={markdownRemarkPlugins} rehypePlugins={rehype} components={components}>
        {text}
      </ReactMarkdown>
    </SourceTextContext.Provider>
  )
})

interface MarkdownProps {
  text: string
  /** Muestra el cursor de escritura al final (respuesta en curso). */
  streaming?: boolean
  /**
   * Resaltar la sintaxis de los bloques de código. Por defecto `!streaming`: lo que aún se está escribiendo no se
   * resalta (re-resaltar todo el mensaje en cada frame era el mayor coste del streaming); al terminar se resalta una vez.
   * Code y Tareas no muestran cursor, así que pasan `highlight={false}` para su último bloque de texto en curso.
   */
  highlight?: boolean
  className?: string
}

export const Markdown = memo(function Markdown({
  text,
  streaming,
  highlight = !streaming,
  className = ''
}: MarkdownProps): React.JSX.Element {
  const hl = useHighlightPlugins(highlight)
  const rehype = hl ?? NO_REHYPE
  // Texto en curso (sin resaltar): solo se vuelve a analizar el último bloque; los anteriores están memoizados.
  // Con resaltado (mensaje terminado) se analiza entero una sola vez, con el mismo resultado de siempre.
  const blocks = highlight ? null : splitMarkdownBlocks(text)
  return (
    <div className={`markdown ${streaming ? 'is-streaming' : ''} ${className}`}>
      <StreamingContext.Provider value={streaming}>
        {blocks ? (
          blocks.map((b, i) => <Block key={i} text={b} rehype={rehype} />)
        ) : (
          <SourceTextContext.Provider value={text}>
            <ReactMarkdown remarkPlugins={markdownRemarkPlugins} rehypePlugins={rehype} components={components}>
              {text}
            </ReactMarkdown>
          </SourceTextContext.Provider>
        )}
      </StreamingContext.Provider>
    </div>
  )
})
