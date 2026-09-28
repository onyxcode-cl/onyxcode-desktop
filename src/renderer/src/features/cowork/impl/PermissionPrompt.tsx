import { useState } from 'react'
import type { PermissionRequest } from '@opencode-ai/sdk/v2/client'
import { ShieldAlert } from 'lucide-react'
import { Button } from '../../../components/Button'
import { replyPermission } from './actions'

const LABELS: Record<string, string> = {
  bash: 'ejecutar un comando',
  edit: 'modificar archivos',
  external_directory: 'acceder fuera de la carpeta',
  webfetch: 'acceder a la web',
  doom_loop: 'repetir la misma acción otra vez'
}

function detail(p: PermissionRequest): string {
  const m = p.metadata
  for (const key of ['command', 'filepath', 'filePath', 'path', 'url']) {
    const v = m[key]
    if (typeof v === 'string' && v) return v
  }
  return p.patterns.join(', ')
}

/** Solicitud de permiso del agente (p.ej. antes de borrar archivos). */
export function PermissionPrompt({ request }: { request: PermissionRequest }): React.JSX.Element {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const answer = (reply: 'once' | 'always' | 'reject'): void => {
    setBusy(true)
    setError(null)
    replyPermission(request.id, reply)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setBusy(false))
  }
  const isDelete = /^(rm|rmdir|unlink|trash)\b|-delete/.test(detail(request))
  return (
    <div className="mx-auto mb-3 w-full max-w-3xl px-6">
      <div className="rounded-xl border border-amber-500/50 bg-amber-500/10 p-3">
        <div className="flex items-start gap-2">
          <ShieldAlert size={18} className="mt-0.5 shrink-0 text-amber-600 dark:text-amber-400" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">
              {isDelete ? 'El agente quiere borrar archivos' : `El agente pide permiso para ${LABELS[request.permission] ?? request.permission}`}
            </p>
            <pre className="mt-1 max-h-32 overflow-auto rounded-md bg-code px-2 py-1 font-mono text-xs whitespace-pre-wrap">
              {detail(request)}
            </pre>
            {error && <p className="mt-1 text-xs text-danger">{error}</p>}
          </div>
        </div>
        <div className="mt-2 flex justify-end gap-2">
          <Button variant="ghost" disabled={busy} onClick={() => answer('reject')}>
            Rechazar
          </Button>
          {!isDelete && (
            <Button disabled={busy} onClick={() => answer('always')}>
              Permitir siempre
            </Button>
          )}
          <Button variant={isDelete ? 'danger' : 'primary'} disabled={busy} onClick={() => answer('once')}>
            Permitir
          </Button>
        </div>
      </div>
    </div>
  )
}
