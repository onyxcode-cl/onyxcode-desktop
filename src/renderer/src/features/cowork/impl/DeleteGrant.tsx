/**
 * "Permitir borrar, mover y renombrar": concede/retira el permiso de Seatbelt `file-write-unlink`
 * para el servidor sandboxeado de la carpeta (`cowork:deleteGrant:*`, ver
 * `src/main/cowork/sandbox-profile.ts`). Como mover o renombrar también es un `unlink` del origen,
 * el mismo permiso cubre las tres cosas. Incluye el interruptor (panel de proyecto) y la tarjeta
 * que aparece cuando el agente lo intenta y falla con "Operation not permitted".
 */
import { useState } from 'react'
import { Loader2, Trash2 } from 'lucide-react'
import { COWORK_TERMS } from '@shared/cowork-glossary'
import { Button } from '../../../components/Button'
import { errorMessage } from '../../../lib/opencode'
import type { MessageEntry } from '../../../stores/sessions'
import { setDeleteGrantAllowed } from './actions'
import { useCowork } from './store'
import { looksLikeBlockedDelete } from './util'

/** Interruptor «Permitir borrar, mover y renombrar», con la advertencia de que reinicia el servidor de la tarea. */
export function DeleteGrantToggle(): React.JSX.Element | null {
  const folder = useCowork((s) => s.folder)
  const allowed = useCowork((s) => s.deleteGrant)
  const busy = useCowork((s) => s.deleteGrantBusy)
  const [error, setError] = useState<string | null>(null)
  if (!folder) return null

  const toggle = async (): Promise<void> => {
    setError(null)
    try {
      await setDeleteGrantAllowed(!allowed)
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  return (
    <div className="rounded-lg border border-border p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium">{COWORK_TERMS.deleteGrant}</p>
          <p className="mt-0.5 text-xs text-subtle">
            Si lo activas, el agente podrá borrar, mover y renombrar archivos dentro de esta carpeta (comandos como{' '}
            <code className="font-mono">rm</code> o <code className="font-mono">mv</code>). Cambiar esto reinicia el servidor sandboxeado de
            la tarea: la tarea en curso se cerrará y tendrás que reabrirla y pedirle que continúe.
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={!!allowed}
          aria-label={COWORK_TERMS.deleteGrant}
          disabled={busy || allowed === null}
          onClick={() => void toggle()}
          className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors duration-200 disabled:opacity-40 ${
            allowed ? 'bg-accent' : 'bg-border-strong'
          }`}
        >
          {busy && <Loader2 size={12} className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 animate-spin text-white/80" />}
          <span
            className={`inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-transform duration-200 ease-out ${
              allowed ? 'translate-x-4.5' : 'translate-x-0.5'
            }`}
          />
        </button>
      </div>
      {error && <p className="mt-2 text-xs text-danger">{error}</p>}
    </div>
  )
}

/** Tarjeta ofreciendo activar «Permitir borrar, mover y renombrar» cuando un intento falló por el sandbox. */
export function DeleteGrantHintCard({ entries }: { entries: MessageEntry[] }): React.JSX.Element | null {
  const deleteGrant = useCowork((s) => s.deleteGrant)
  const busy = useCowork((s) => s.deleteGrantBusy)
  const [dismissed, setDismissed] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string | null>(null)

  if (deleteGrant === true) return null

  let hitId: string | null = null
  outer: for (const e of entries) {
    for (const p of e.parts) {
      if (p.type === 'tool' && looksLikeBlockedDelete(p) && !dismissed.has(p.id)) {
        hitId = p.id
        break outer
      }
    }
  }
  if (!hitId) return null
  const id = hitId

  const enable = async (): Promise<void> => {
    setError(null)
    try {
      await setDeleteGrantAllowed(true)
      setDismissed((s) => new Set(s).add(id))
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  return (
    <div className="rounded-xl border border-warning/40 bg-warning/5 p-3.5">
      <div className="flex items-start gap-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-warning/15 text-warning">
          <Trash2 size={16} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">El agente intentó borrar, mover o renombrar un archivo y no pudo</p>
          <p className="mt-0.5 text-xs text-muted">
            Por seguridad, esta carpeta no permite borrar, mover ni renombrar archivos todavía. Si lo activas, el servidor de la tarea se
            reiniciará y tendrás que reabrir esta tarea y pedirle al agente que continúe. Si prefieres no hacerlo, pídele una copia ordenada
            sin tocar los originales.
          </p>
          {error && <p className="mt-1.5 text-xs text-danger">{error}</p>}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button variant="primary" disabled={busy} onClick={() => void enable()}>
              {busy && <Loader2 size={14} className="animate-spin" />} {COWORK_TERMS.deleteGrant}
            </Button>
            <Button variant="ghost" disabled={busy} onClick={() => setDismissed((s) => new Set(s).add(id))}>
              Ahora no
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
