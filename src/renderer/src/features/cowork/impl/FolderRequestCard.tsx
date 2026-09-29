/**
 * Tarjeta «El agente quiere trabajar en otra carpeta» (permiso `external_directory`). Muestra la ruta
 * literal que pide el agente, deja elegir una carpeta más amplia (ancestros), el modo (lectura y
 * escritura o solo lectura), el motivo que declara el agente (texto del modelo, no verificado) y una
 * casilla para dejarla como carpeta de confianza. Responde con `answerFolderRequest`.
 */
import { useEffect, useId, useMemo, useState } from 'react'
import { FolderInput, Loader2, ShieldAlert } from 'lucide-react'
import type { PermissionRequest } from '@opencode-ai/sdk/v2/client'
import type { FolderAccessMode } from '@shared/ipc-cowork'
import { COWORK_TERMS } from '@shared/cowork-glossary'
import { Button } from '../../../components/Button'
import { errorMessage } from '../../../lib/opencode'
import { useSessions } from '../../../stores/sessions'
import { answerFolderRequest } from './actions'
import { cw } from './bridge'
import { folderRequestView } from './conversation-logic'
import { rootTaskId, useCowork } from './store'
import { lastAssistantText } from './transcript'
import { folderRequestPaths } from './util'

const MODES: Array<{ mode: FolderAccessMode; label: string; hint: string }> = [
  { mode: 'ro', label: COWORK_TERMS.readOnly, hint: 'Podrá leer los archivos, no cambiarlos.' },
  { mode: 'rw', label: COWORK_TERMS.readWrite, hint: 'Podrá leer, crear y modificar archivos.' }
]

function hiddenNote(text: string): boolean {
  // eslint-disable-next-line no-control-regex
  return /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F​-‏‪-‮⁠-⁤﻿]/.test(text)
}

export function FolderRequestCard({ request }: { request: PermissionRequest }): React.JSX.Element {
  const conn = useCowork((s) => s.conn)
  const policy = useCowork((s) => s.policy)
  const fullAccess = conn?.fullAccess === true
  const taskId = useMemo(() => rootTaskId(request.sessionID), [request.sessionID])
  // Mensajes de la sesión que pide (puede ser una subtarea) o, si no hay, los de la tarea.
  const entries = useSessions((s) => {
    const own = s.messages[request.sessionID]
    return own && own.length > 0 ? own : s.messages[taskId]
  })
  const paths = useMemo(() => folderRequestPaths(request), [request])
  const view = useMemo(
    () => folderRequestView(request, paths, entries ? lastAssistantText(entries) : ''),
    [request, paths, entries]
  )

  const [selected, setSelected] = useState(view.candidates[0] ?? '')
  const [mode, setMode] = useState<FolderAccessMode>('ro')
  const [trust, setTrust] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [reason, setReason] = useState<string | null>(null)
  const uid = useId()

  // En sandbox se comprueba de antemano si main aceptaría la carpeta elegida (rutas prohibidas).
  useEffect(() => {
    setReason(null)
    if (fullAccess || !selected) return
    let cancelled = false
    cw('cowork:folders:check', { path: selected })
      .then((chk) => {
        if (!cancelled && !chk.ok) setReason(chk.reason ?? 'Esa carpeta no se puede añadir.')
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [selected, fullAccess])

  const canTrust = !policy?.disableAlwaysAllow
  const showMode = !fullAccess || (trust && canTrust)
  const noPath = !selected
  const widened = !!selected && selected !== view.requested

  const respond = async (kind: 'deny' | 'later' | 'allow'): Promise<void> => {
    setBusy(true)
    setError(null)
    const before = useCowork.getState().error
    try {
      if (kind === 'allow') {
        await answerFolderRequest(request, { kind, path: selected, mode, trust: trust && canTrust })
      } else {
        await answerFolderRequest(request, { kind })
      }
      // `answerFolderRequest` deja sus fallos en el estado de Cowork: se muestran aquí, junto a la tarjeta.
      const after = useCowork.getState().error
      if (after && after !== before) setError(after)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div id={`perm-${request.id}`} tabIndex={-1} className="rounded-xl border border-warning/40 bg-warning/5 p-3.5 outline-none">
      <div className="flex items-start gap-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-warning/15 text-warning">
          <FolderInput size={16} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">El agente quiere trabajar en otra carpeta</p>
          <p className="mt-0.5 text-xs text-muted">
            {fullAccess
              ? 'Esta ubicación queda fuera de la carpeta de la tarea. Si la permites, el agente podrá acceder a ella.'
              : 'Esta ubicación queda fuera de la carpeta de la tarea. Al permitirla se reiniciará el espacio de trabajo de Cowork y la tarea continuará sola.'}
          </p>

          <p className="mt-2.5 text-[11px] font-medium text-subtle">Carpeta que pide el agente</p>
          <pre className="mt-1 max-h-24 overflow-auto rounded-md border border-border bg-code px-2.5 py-1.5 font-mono text-xs whitespace-pre-wrap">
            {view.requested || 'No se pudo determinar la carpeta'}
          </pre>
          {view.requested && hiddenNote(view.requested) && (
            <p className="mt-1.5 flex items-start gap-1.5 text-xs text-danger">
              <ShieldAlert size={13} className="mt-0.5 shrink-0" />
              La ruta contiene caracteres de control o invisibles que no se muestran arriba. Revisa con cuidado antes de permitir.
            </p>
          )}
          {view.command && (
            <>
              <p className="mt-2 text-[11px] font-medium text-subtle">Comando que lo provoca</p>
              <pre className="mt-1 max-h-24 overflow-auto rounded-md border border-border bg-code px-2.5 py-1.5 font-mono text-xs whitespace-pre-wrap">
                {view.command}
              </pre>
              {hiddenNote(view.command) && (
                <p className="mt-1.5 flex items-start gap-1.5 text-xs text-danger">
                  <ShieldAlert size={13} className="mt-0.5 shrink-0" />
                  El comando contiene caracteres de control o invisibles que no se muestran arriba. Revisa con cuidado antes de permitir.
                </p>
              )}
            </>
          )}

          <div className="mt-2.5 rounded-md border border-border/70 bg-hover/40 px-2.5 py-1.5">
            <p className="text-[11px] font-medium text-subtle">Motivo (según el agente, no verificado)</p>
            <p className="mt-0.5 text-xs text-muted">{view.motive || 'El agente no indicó un motivo.'}</p>
          </div>

          {view.candidates.length > 1 && (
            <fieldset className="mt-3 min-w-0">
              <legend className="text-[11px] font-medium text-subtle">Carpeta a la que darás acceso</legend>
              <div role="radiogroup" className="mt-1 space-y-1">
                {view.candidates.map((c, i) => (
                  <label
                    key={c}
                    className="flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-xs hover:bg-hover has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent"
                  >
                    <input
                      type="radio"
                      name={`${uid}-path`}
                      checked={selected === c}
                      onChange={() => setSelected(c)}
                      disabled={busy}
                      className="accent-[var(--accent)]"
                    />
                    <span className="min-w-0 flex-1 truncate font-mono" title={c}>
                      {c}
                    </span>
                    {i === 0 && <span className="shrink-0 text-[11px] text-subtle">la que pide</span>}
                  </label>
                ))}
              </div>
              {widened && (
                <p className="mt-1 text-[11px] text-warning">
                  Darás acceso también a todo lo que hay dentro de esta carpeta, más amplia que la que pide el agente.
                </p>
              )}
            </fieldset>
          )}

          {showMode && (
            <fieldset className="mt-3 min-w-0">
              <legend className="text-[11px] font-medium text-subtle">Modo de acceso</legend>
              <div role="radiogroup" className="mt-1 flex flex-wrap gap-1.5">
                {MODES.map((m) => (
                  <label
                    key={m.mode}
                    title={m.hint}
                    className={`flex cursor-pointer items-center gap-2 rounded-lg border px-2.5 py-1 text-xs has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent ${
                      mode === m.mode ? 'border-accent/50 bg-accent-soft text-accent' : 'border-border text-muted hover:bg-hover'
                    }`}
                  >
                    <input
                      type="radio"
                      name={`${uid}-mode`}
                      checked={mode === m.mode}
                      onChange={() => setMode(m.mode)}
                      disabled={busy}
                      className="sr-only"
                    />
                    {m.label}
                  </label>
                ))}
              </div>
              <p className="mt-1 text-[11px] text-subtle">{MODES.find((m) => m.mode === mode)?.hint}</p>
            </fieldset>
          )}

          {canTrust && (
            <label className="mt-3 flex cursor-pointer items-start gap-2 text-xs">
              <input
                type="checkbox"
                checked={trust}
                onChange={(e) => setTrust(e.target.checked)}
                disabled={busy}
                className="mt-0.5 accent-[var(--accent)]"
              />
              <span>
                No volver a preguntar (carpeta de confianza)
                {trust && (
                  <span className="mt-0.5 block text-[11px] text-subtle">
                    Se añadirá a «{COWORK_TERMS.trustedFolders}» en Ajustes, donde podrás quitarla.
                  </span>
                )}
              </span>
            </label>
          )}

          {reason && !fullAccess && (
            <p className="mt-2 flex items-start gap-1.5 text-xs text-danger">
              <ShieldAlert size={13} className="mt-0.5 shrink-0" />
              {reason}
            </p>
          )}
          {error && <p className="mt-2 text-xs text-danger">{error}</p>}

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button variant="ghost" disabled={busy} onClick={() => void respond('deny')}>
              Denegar
            </Button>
            <Button variant="secondary" disabled={busy} onClick={() => void respond('later')}>
              Ahora no
            </Button>
            <Button variant="primary" disabled={busy || noPath || (!fullAccess && !!reason)} onClick={() => void respond('allow')}>
              {busy && <Loader2 size={14} className="animate-spin" />} Permitir
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
