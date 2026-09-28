import { memo, useState, type ReactNode } from 'react'
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

function CodeBlock({ children }: { children?: ReactNode }): React.JSX.Element {
  const [copied, setCopied] = useState(false)
  const copy = (): void => {
    void navigator.clipboard.writeText(textOf(children)).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }
  return (
    <div className="group relative">
      <button
        type="button"
        onClick={copy}
        title="Copiar código"
        className="absolute top-2 right-2 rounded-md border border-border bg-elevated p-1 text-muted opacity-0 transition group-hover:opacity-100 hover:text-fg"
      >
        {copied ? <Check size={14} /> : <Copy size={14} />}
      </button>
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

export const Markdown = memo(function Markdown({ text }: { text: string }): React.JSX.Element {
  return (
    <div className="markdown">
      <ReactMarkdown remarkPlugins={remarkPlugins} rehypePlugins={rehypePlugins} components={components}>
        {text}
      </ReactMarkdown>
    </div>
  )
})
