import { useState } from 'react'
import { HelpCircle, ShieldAlert } from 'lucide-react'
import { Button } from '../../../components/Button'
import { DiffView } from './DiffView'
import { relPath } from './ToolCard'
import { useCode } from './store'
import type { PendingPermission, PendingQuestion } from './types'

const PERMISSION_LABEL: Record<string, string> = {
  edit: 'editar archivos',
  write: 'escribir archivos',
  bash: 'ejecutar un comando',
  webfetch: 'acceder a una URL',
  websearch: 'buscar en la web',
  read: 'leer archivos',
  external_directory: 'acceder fuera del proyecto',
  task: 'lanzar un subagente',
  doom_loop: 'repetir la misma acción',
  todowrite: 'actualizar la lista de tareas'
}

export function PermissionCard({ request, root }: { request: PendingPermission; root: string | null }): React.JSX.Element {
  const reply = useCode((s) => s.replyPermission)
  const [busy, setBusy] = useState(false)
  const run = (r: 'once' | 'always' | 'reject'): void => {
    setBusy(true)
    void reply(request, r).finally(() => setBusy(false))
  }
  const md = request.metadata
  const diff = typeof md.diff === 'string' ? md.diff : ''
  const command = typeof md.command === 'string' ? md.command : ''
  const file = typeof md.filepath === 'string' ? md.filepath : typeof md.filePath === 'string' ? md.filePath : ''
  const label = PERMISSION_LABEL[request.permission] ?? request.permission

  return (
    <div className="my-2 overflow-hidden rounded-xl border border-accent/50 bg-elevated shadow-sm">
      <div className="flex items-start gap-2 px-3 py-2.5">
        <ShieldAlert size={16} className="mt-0.5 shrink-0 text-accent" />
        <div className="min-w-0 flex-1 text-sm">
          <div className="font-medium">El agente quiere {label}</div>
          {file && <div className="mt-0.5 truncate font-mono text-xs text-muted">{relPath(file, root)}</div>}
          {(command || request.patterns.length > 0) && (
            <pre className="mt-1.5 max-h-40 overflow-auto rounded-md bg-code px-2 py-1.5 font-mono text-xs whitespace-pre-wrap break-all">
              {command || request.patterns.map((p) => relPath(p, root)).join('\n')}
            </pre>
          )}
        </div>
      </div>
      {diff && <DiffView patch={diff} hideFileHeaders className="max-h-72 border-t border-border" />}
      <div className="flex flex-wrap items-center gap-2 border-t border-border px-3 py-2">
        <Button variant="primary" disabled={busy} onClick={() => run('once')}>
          Permitir una vez
        </Button>
        <Button
          disabled={busy}
          onClick={() => run('always')}
          title={request.always.length ? `Patrones: ${request.always.join(', ')}` : undefined}
        >
          Permitir siempre
        </Button>
        <Button variant="ghost" disabled={busy} onClick={() => run('reject')} className="text-danger">
          Rechazar
        </Button>
      </div>
    </div>
  )
}

export function QuestionCard({ request }: { request: PendingQuestion }): React.JSX.Element {
  const reply = useCode((s) => s.replyQuestion)
  const reject = useCode((s) => s.rejectQuestion)
  const [answers, setAnswers] = useState<string[][]>(() => request.questions.map(() => []))
  const [custom, setCustom] = useState<string[]>(() => request.questions.map(() => ''))
  const [busy, setBusy] = useState(false)

  const toggle = (qi: number, label: string, multiple: boolean): void => {
    setAnswers((prev) =>
      prev.map((a, i) => {
        if (i !== qi) return a
        if (!multiple) return [label]
        return a.includes(label) ? a.filter((x) => x !== label) : [...a, label]
      })
    )
  }

  const final = answers.map((a, i) => (custom[i].trim() ? [...a, custom[i].trim()] : a))
  const ready = final.every((a) => a.length > 0)

  return (
    <div className="my-2 rounded-xl border border-accent/50 bg-elevated px-3 py-2.5 shadow-sm">
      {request.questions.map((q, qi) => (
        <div key={qi} className="mb-3">
          <div className="flex items-start gap-2 text-sm">
            <HelpCircle size={16} className="mt-0.5 shrink-0 text-accent" />
            <div>
              {q.header && <div className="text-xs font-medium tracking-wide text-muted uppercase">{q.header}</div>}
              <div className="font-medium">{q.question}</div>
            </div>
          </div>
          <div className="mt-2 ml-6 flex flex-wrap gap-2">
            {q.options.map((o) => {
              const selected = answers[qi]?.includes(o.label)
              return (
                <button
                  key={o.label}
                  type="button"
                  title={o.description}
                  onClick={() => toggle(qi, o.label, !!q.multiple)}
                  className={`rounded-lg border px-2.5 py-1 text-sm transition ${selected ? 'border-accent bg-accent-soft text-fg' : 'border-border hover:bg-hover'}`}
                >
                  {o.label}
                </button>
              )
            })}
          </div>
          {q.custom !== false && (
            <input
              value={custom[qi]}
              onChange={(e) => setCustom((prev) => prev.map((c, i) => (i === qi ? e.target.value : c)))}
              placeholder="Otra respuesta…"
              className="mt-2 ml-6 w-[calc(100%-1.5rem)] rounded-lg border border-border bg-bg px-2.5 py-1 text-sm outline-none focus:border-accent"
            />
          )}
        </div>
      ))}
      <div className="flex gap-2">
        <Button
          variant="primary"
          disabled={busy || !ready}
          onClick={() => {
            setBusy(true)
            void reply(request, final).finally(() => setBusy(false))
          }}
        >
          Responder
        </Button>
        <Button
          variant="ghost"
          disabled={busy}
          onClick={() => {
            setBusy(true)
            void reject(request).finally(() => setBusy(false))
          }}
        >
          Omitir
        </Button>
      </div>
    </div>
  )
}
