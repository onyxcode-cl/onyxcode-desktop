import { isValidElement, memo, useState, type ReactNode } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import { Check, Copy } from 'lucide-react'

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
  return (
    <div className="code-block">
      <div className="code-block-header">
        <span className="flex-1 truncate font-medium">{lang ?? 'Código'}</span>
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
const rehypePlugins = [[rehypeHighlight, { detect: true, ignoreMissing: true }] as [typeof rehypeHighlight, object]]

interface MarkdownProps {
  text: string
  /** Muestra el cursor de escritura al final (respuesta en curso). */
  streaming?: boolean
  className?: string
}

export const Markdown = memo(function Markdown({ text, streaming, className = '' }: MarkdownProps): React.JSX.Element {
  return (
    <div className={`markdown ${streaming ? 'is-streaming' : ''} ${className}`}>
      <ReactMarkdown remarkPlugins={remarkPlugins} rehypePlugins={rehypePlugins} components={components}>
        {text}
      </ReactMarkdown>
    </div>
  )
})
