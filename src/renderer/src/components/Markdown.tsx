import { isValidElement, memo, useState, type ReactNode } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import { Check, Copy } from 'lucide-react'
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
  dockerfile: 'Dockerfile',
  plaintext: 'Texto',
  text: 'Texto'
}

function languageOf(children: ReactNode): string | null {
  const child = Array.isArray(children) ? children[0] : children
  if (!isValidElement(child)) return null
  const cls = (child.props as { className?: string }).className ?? ''
  const m = /language-([\w+#-]+)/.exec(cls)
  if (!m) return null
  const id = m[1].toLowerCase()
  return LANG_LABELS[id] ?? id
}

/** Botón de copiar reutilizable (código, mensajes). */
export function CopyButton({
  text,
  label = 'Copiar',
  className = '',
  showLabel = false,
  size = 13
}: {
  text: string | (() => string)
  label?: string
  className?: string
  showLabel?: boolean
  size?: number
}): React.JSX.Element {
  const [copied, setCopied] = useState(false)
  const copy = (): void => {
    const value = typeof text === 'function' ? text() : text
    void navigator.clipboard.writeText(value).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }
  return (
    <button
      type="button"
      onClick={copy}
      title={copied ? 'Copiado' : label}
      aria-label={label}
      className={`no-drag inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-muted transition-colors hover:bg-hover hover:text-fg ${className}`}
    >
      {copied ? <Check size={size} className="text-success" /> : <Copy size={size} />}
      {showLabel && <span>{copied ? 'Copiado' : label}</span>}
    </button>
  )
}

function CodeBlock({ children }: { children?: ReactNode }): React.JSX.Element {
  const lang = languageOf(children)
  const code = textOf(children)
  // Un bloque marcado como HTML se ofrece siempre que tenga alguna etiqueta (p.ej. un <button>).
  const renderable = lang?.toLowerCase() === 'html' && (looksRenderable(code) || /<[a-z]/i.test(code))
  return (
    <div className="code-block">
      <div className="code-block-header">
        <span className="flex-1 truncate font-medium">{lang ?? 'Código'}</span>
        {renderable && <ArtifactButton html={code} className="py-0.5 text-[11.5px]" />}
        <CopyButton text={() => textOf(children)} label="Copiar" showLabel size={12} className="text-[11.5px]" />
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

const remarkPlugins = [remarkGfm]
// F7-B45: `detect:false` (solo se resaltan los bloques con lenguaje declarado; la autodetección probaba TODOS los
// lenguajes en cada bloque y era lo más caro) y sin resaltar mientras el mensaje se está escribiendo (`highlight` falso).
const rehypePlugins = [[rehypeHighlight, { detect: false, ignoreMissing: true }] as [typeof rehypeHighlight, object]]
const NO_REHYPE: never[] = []

interface MarkdownProps {
  text: string
  /** Muestra el cursor de escritura al final (respuesta en curso). */
  streaming?: boolean
  /**
   * Resaltar la sintaxis de los bloques de código. Por defecto `!streaming`: lo que aún se está escribiendo no se
   * resalta (re-resaltar todo el mensaje en cada frame era el mayor coste del streaming); al terminar se resalta una vez.
   * Code y Cowork no muestran cursor, así que pasan `highlight={false}` para su último bloque de texto en curso.
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
  return (
    <div className={`markdown ${streaming ? 'is-streaming' : ''} ${className}`}>
      <ReactMarkdown remarkPlugins={remarkPlugins} rehypePlugins={highlight ? rehypePlugins : NO_REHYPE} components={components}>
        {text}
      </ReactMarkdown>
    </div>
  )
})
