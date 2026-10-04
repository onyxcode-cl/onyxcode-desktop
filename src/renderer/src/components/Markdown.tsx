import { isValidElement, memo, type ReactNode } from 'react'
import ReactMarkdown, { type Components, type Options } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { t } from '@shared/i18n'
import { CopyButton } from './CopyButton'
import { useHighlightPlugins } from './highlight-plugins'
import { ArtifactButton, looksRenderable } from './artifacts/ArtifactButton'

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

function languageOf(children: ReactNode): string | null {
  const child = Array.isArray(children) ? children[0] : children
  if (!isValidElement(child)) return null
  const cls = (child.props as { className?: string }).className ?? ''
  const m = /language-([\w+#-]+)/.exec(cls)
  if (!m) return null
  const id = m[1].toLowerCase()
  if (id === 'plaintext' || id === 'text') return t('common.plainText')
  return LANG_LABELS[id] ?? id
}

function CodeBlock({ children }: { children?: ReactNode }): React.JSX.Element {
  const lang = languageOf(children)
  const code = textOf(children)
  // Un bloque marcado como HTML se ofrece siempre que tenga alguna etiqueta (p.ej. un <button>).
  const renderable = lang?.toLowerCase() === 'html' && (looksRenderable(code) || /<[a-z]/i.test(code))
  return (
    <div className="code-block">
      <div className="code-block-header">
        <span className="flex-1 truncate font-medium">{lang ?? t('common.code')}</span>
        {renderable && <ArtifactButton html={code} className="py-0.5 text-[11.5px]" />}
        <CopyButton text={() => textOf(children)} showLabel size={12} className="text-[11.5px]" />
      </div>
      <pre>{children}</pre>
    </div>
  )
}

const components: Components = {
  pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
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
    <ReactMarkdown remarkPlugins={markdownRemarkPlugins} rehypePlugins={rehype} components={components}>
      {text}
    </ReactMarkdown>
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
      {blocks ? (
        blocks.map((b, i) => <Block key={i} text={b} rehype={rehype} />)
      ) : (
        <ReactMarkdown remarkPlugins={markdownRemarkPlugins} rehypePlugins={rehype} components={components}>
          {text}
        </ReactMarkdown>
      )}
    </div>
  )
})
