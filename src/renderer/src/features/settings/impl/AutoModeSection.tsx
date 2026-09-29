/**
 * Ajustes › Modo auto: aprueba en automático solo lo de bajo riesgo (bash de solo lectura,
 * herramientas MCP de solo consulta y "Solo ver" de un puñado de apps), con un interruptor maestro
 * apagado por defecto (kill switch), opt-in por carpeta o por tarea, un registro con "Revocar" y
 * "Vaciar registro", y un editor de las apps que puede ver sin preguntar. La lógica vive en
 * `main/tasks/auto-mode.ts` (clasificador puro) y `auto-approver.ts` (motor); aquí solo se lee y
 * se edita ese estado (`tasks:auto:*`).
 */
import { useEffect, useState } from 'react'
import { Eye, FolderClosed, Loader2, Plus, ShieldCheck, Trash2, Zap } from 'lucide-react'
import type { AutoModeState, TasksFolder, TasksTaskMeta } from '@shared/ipc-tasks'
import { cw, hasTasksBridge } from '../../tasks/impl/bridge'
import { Badge, Card, ErrorText, Row, SectionHeader, SubTitle, TextInput, Toggle } from './ui'
import { errText } from '../../../lib/format'
import { isSubmitKey } from '../../../lib/textarea'

/** Nombres legibles de las apps propuestas por defecto (el resto se muestra por su bundle id). */
const APP_LABELS: Record<string, string> = {
  'com.apple.finder': 'Finder',
  'com.apple.Preview': 'Vista previa',
  'com.apple.TextEdit': 'TextEdit',
  'com.apple.calculator': 'Calculadora',
  'com.apple.Maps': 'Mapas',
  'com.apple.weather': 'Tiempo',
  'com.apple.clock': 'Reloj',
  'com.apple.iWork.Pages': 'Pages',
  'com.apple.iWork.Numbers': 'Numbers',
  'com.apple.iWork.Keynote': 'Keynote'
}

function appLabel(bundleId: string): string {
  return APP_LABELS[bundleId] ?? bundleId
}

function fmtAt(at: number): string {
  return new Date(at).toLocaleString('es-CL', { dateStyle: 'medium', timeStyle: 'short' })
}

export function AutoModeSection(): React.JSX.Element {
  const [state, setState] = useState<AutoModeState | null>(null)
  const [folders, setFolders] = useState<TasksFolder[]>([])
  const [taskMeta, setTaskMeta] = useState<Record<string, TasksTaskMeta>>({})
  const [newApp, setNewApp] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const reload = (): void => {
    if (!hasTasksBridge()) return
    void cw('tasks:auto:state')
      .then(setState)
      .catch((err: unknown) => setError(errText(err)))
  }

  useEffect(reload, [])

  useEffect(() => {
    if (!hasTasksBridge()) return
    cw('tasks:listFolders')
      .then(setFolders)
      .catch(() => undefined)
    cw('tasks:tasks:list')
      .then((list) => setTaskMeta(Object.fromEntries(list.map((m) => [m.sessionId, m]))))
      .catch(() => undefined)
  }, [])

  if (!hasTasksBridge()) {
    return (
      <div>
        <SectionHeader title="Modo auto" description="Solo disponible en la app de escritorio." />
      </div>
    )
  }

  const run = (key: string, fn: () => Promise<AutoModeState>): void => {
    setError(null)
    setBusy(key)
    fn()
      .then(setState)
      .catch((err: unknown) => setError(errText(err)))
      .finally(() => setBusy(null))
  }

  const settings = state?.settings
  const enabled = settings?.enabled === true

  const toggleFolder = (path: string, on: boolean): void => run(`folder:${path}`, () => cw('tasks:auto:set', { folder: { path, on } }))
  const toggleTask = (sessionId: string, on: boolean): void =>
    run(`task:${sessionId}`, () => cw('tasks:auto:set', { task: { sessionId, on } }))

  const addViewApp = (): void => {
    const bundleId = newApp.trim()
    if (!bundleId || !settings) return
    setNewApp('')
    run('viewApps', () => cw('tasks:auto:set', { viewApps: [...new Set([...settings.viewApps, bundleId])] }))
  }
  const removeViewApp = (bundleId: string): void => {
    if (!settings) return
    run('viewApps', () => cw('tasks:auto:set', { viewApps: settings.viewApps.filter((a) => a !== bundleId) }))
  }

  const revoke = (id: string): void => run(`revoke:${id}`, () => cw('tasks:auto:revoke', { id }))
  const clearLog = (): void => run('clearLog', () => cw('tasks:auto:clearLog'))

  const log = [...(state?.log ?? [])].sort((a, b) => b.at - a.at)

  return (
    <div>
      <SectionHeader
        title="Modo auto"
        description="Aprueba en automático solo lo de bajo riesgo: comandos de terminal de solo lectura, herramientas de conectores MCP de solo consulta, y «Solo ver» de un puñado de apps conocidas. Todo lo demás sigue preguntando siempre."
      />

      {state?.policyDisabled && (
        <div role="status" className="mb-5 flex items-start gap-3 rounded-xl border border-accent/30 bg-accent-soft px-4 py-3 text-xs">
          <ShieldCheck size={16} className="mt-0.5 shrink-0 text-accent" aria-hidden />
          <div className="min-w-0 text-muted">
            <div className="text-sm font-medium text-fg">Gestionado por tu organización</div>
            <p className="mt-0.5">Tu organización desactivó el Modo auto: aunque lo actives aquí, seguirá preguntando siempre.</p>
          </div>
        </div>
      )}

      <Card>
        <Row
          label={
            <span className="flex items-center gap-2">
              <Zap size={14} className="text-accent" /> Modo auto (aprobar solo lo de bajo riesgo)
            </span>
          }
          description="Interruptor maestro: apagado por defecto. Con él apagado, todo vuelve a preguntar como siempre."
        >
          <Toggle
            checked={enabled}
            onChange={(v) => run('enabled', () => cw('tasks:auto:set', { enabled: v }))}
            label="Modo auto"
            disabled={busy === 'enabled' || state?.policyDisabled}
          />
        </Row>
      </Card>

      <SubTitle>Lo que el Modo auto NUNCA aprueba solo</SubTitle>
      <Card className="px-4 py-3 text-xs text-muted">
        <ul className="list-disc space-y-1 pl-4">
          <li>Carpetas fuera de la tarea, bucles repetidos, y las herramientas del navegador o de control del Mac.</li>
          <li>
            Borrar, mover o renombrar nada (comandos como <code className="font-mono">rm</code>, <code className="font-mono">mv</code> o{' '}
            <code className="font-mono">find -delete</code>).
          </li>
          <li>Editar o escribir archivos, ejecutar tareas de fondo, o consultar la web.</li>
          <li>Cualquier herramienta MCP que no sea claramente de consulta por su nombre (nada de crear, enviar, borrar, pagar…).</li>
          <li>Texto que parezca una instrucción inyectada (p. ej. «ignora las instrucciones anteriores»).</li>
          <li>Tarjetas con un plan de pasos, o de tomar el control de la pantalla («¿Tomar el control…?»).</li>
          <li>Acceso a apps con un nivel distinto de «Solo ver», o a apps fuera de la lista de abajo.</li>
        </ul>
      </Card>

      <SubTitle>Carpetas con el modo activo</SubTitle>
      <Card>
        {folders.length === 0 ? (
          <Row label="Sin carpetas de trabajo todavía" description="Autoriza una carpeta desde Tareas para poder activarlo aquí." />
        ) : (
          folders.map((f) => (
            <Row key={f.path} label={f.name} description={<span className="font-mono break-all">{f.path}</span>}>
              {busy === `folder:${f.path}` ? (
                <Loader2 size={14} className="animate-spin text-muted" />
              ) : (
                <Toggle
                  checked={settings?.folders.includes(f.path) === true}
                  onChange={(v) => toggleFolder(f.path, v)}
                  label={`Modo auto en ${f.name}`}
                  disabled={!enabled}
                />
              )}
            </Row>
          ))
        )}
      </Card>

      {(settings?.tasks.length ?? 0) > 0 && (
        <>
          <SubTitle>Tareas concretas con el modo activo</SubTitle>
          <Card>
            {settings?.tasks.map((sessionId) => (
              <Row
                key={sessionId}
                label={
                  <span className="flex items-center gap-1.5">
                    <FolderClosed size={12} className="text-subtle" /> {taskMeta[sessionId]?.title || 'Tarea'}
                  </span>
                }
                description={taskMeta[sessionId]?.folder}
              >
                <button
                  type="button"
                  onClick={() => toggleTask(sessionId, false)}
                  disabled={busy === `task:${sessionId}`}
                  className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-danger hover:bg-danger/10"
                >
                  <Trash2 size={12} /> Quitar
                </button>
              </Row>
            ))}
          </Card>
        </>
      )}

      <SubTitle>Apps que puede ver sin preguntar</SubTitle>
      <Card>
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <TextInput
            value={newApp}
            onChange={(e) => setNewApp(e.target.value)}
            onKeyDown={(e) => isSubmitKey(e, { allowShift: true }) && addViewApp()}
            placeholder="com.ejemplo.app (bundle id)"
            aria-label="Añadir app que el modo auto puede ver"
            className="max-w-xs font-mono"
          />
          <button
            type="button"
            onClick={addViewApp}
            disabled={!newApp.trim()}
            className="flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium hover:bg-hover disabled:pointer-events-none disabled:opacity-50"
          >
            <Plus size={13} /> Añadir
          </button>
        </div>
        {(settings?.viewApps.length ?? 0) === 0 ? (
          <Row label="Sin apps en la lista" description="El agente nunca concederá «Solo ver» en automático." />
        ) : (
          settings?.viewApps.map((bundleId) => (
            <Row key={bundleId} label={appLabel(bundleId)} description={<span className="font-mono">{bundleId}</span>}>
              <button
                type="button"
                onClick={() => removeViewApp(bundleId)}
                className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-danger hover:bg-danger/10"
              >
                <Trash2 size={13} /> Quitar
              </button>
            </Row>
          ))
        )}
        <p className="border-t border-border px-4 py-2.5 text-xs text-subtle">
          Solo aplica a peticiones a mitad de tarea con nivel «Solo ver»: gestores de contraseñas, Ajustes del sistema, Mensajes, Mail,
          terminales, IDE y apps de banca nunca se conceden en automático, aunque las añadas aquí.
        </p>
      </Card>

      <SubTitle>Registro de aprobaciones automáticas</SubTitle>
      <Card>
        <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-2.5">
          <span className="text-xs text-muted">{log.length === 0 ? 'Sin aprobaciones todavía' : `${log.length} entradas`}</span>
          <button
            type="button"
            onClick={clearLog}
            disabled={log.length === 0 || busy === 'clearLog'}
            className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-danger hover:bg-danger/10 disabled:pointer-events-none disabled:opacity-40"
          >
            {busy === 'clearLog' ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />} Vaciar registro
          </button>
        </div>
        {log.map((r) => (
          <Row
            key={r.id}
            label={
              <span className="flex items-center gap-1.5">
                {r.kind === 'access' ? <Eye size={12} className="text-accent" /> : <ShieldCheck size={12} className="text-accent" />}
                {r.summary}
              </span>
            }
            description={
              <span>
                {fmtAt(r.at)}
                {r.folder && <span className="font-mono"> · {r.folder}</span>}
                {r.revokedAt && <span className="text-danger"> · revocado</span>}
              </span>
            }
          >
            {r.revocable && !r.revokedAt && (
              <button
                type="button"
                onClick={() => revoke(r.id)}
                disabled={busy === `revoke:${r.id}`}
                className="flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-xs font-medium hover:bg-hover disabled:opacity-50"
              >
                {busy === `revoke:${r.id}` ? <Loader2 size={12} className="animate-spin" /> : null} Revocar
              </button>
            )}
          </Row>
        ))}
      </Card>

      {error && (
        <div className="mt-3">
          <ErrorText>{error}</ErrorText>
        </div>
      )}
      <p className="mt-4 flex items-center gap-2 text-xs text-subtle">
        <Badge tone="muted">Solo motor de reglas</Badge> Sin clasificador por modelo: cada aprobación pasa por una lista cerrada de patrones
        seguros, no por una decisión del propio agente.
      </p>
    </div>
  )
}
