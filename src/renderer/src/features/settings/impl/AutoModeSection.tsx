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
import { getLang, t as tr, type MsgKey } from '@shared/i18n'
import { UI_LABELS } from '@shared/labels'
import { cw, hasTasksBridge } from '../../tasks/impl/bridge'
import { Badge, Card, ErrorText, Row, SectionHeader, SubTitle, TextInput, Toggle } from './ui'
import { errText } from '../../../lib/format'
import { useT } from '../../../lib/i18n'
import { isSubmitKey } from '../../../lib/textarea'

/** Nombres legibles de las apps propuestas por defecto (el resto se muestra por su bundle id). */
const APP_LABELS: Record<string, MsgKey> = {
  'com.apple.finder': 'misc.auto.app.finder',
  'com.apple.Preview': 'misc.auto.app.preview',
  'com.apple.TextEdit': 'misc.auto.app.textedit',
  'com.apple.calculator': 'misc.auto.app.calculator',
  'com.apple.Maps': 'misc.auto.app.maps',
  'com.apple.weather': 'misc.auto.app.weather',
  'com.apple.clock': 'misc.auto.app.clock',
  'com.apple.iWork.Pages': 'misc.auto.app.pages',
  'com.apple.iWork.Numbers': 'misc.auto.app.numbers',
  'com.apple.iWork.Keynote': 'misc.auto.app.keynote'
}

function appLabel(bundleId: string): string {
  const key = APP_LABELS[bundleId]
  return key ? tr(key) : bundleId
}

function fmtAt(at: number): string {
  return new Date(at).toLocaleString(getLang() === 'en' ? 'en-US' : 'es-CL', { dateStyle: 'medium', timeStyle: 'short' })
}

export function AutoModeSection(): React.JSX.Element {
  const t = useT()
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
        <SectionHeader title={UI_LABELS.autoMode} description={t('misc.desktopOnly')} />
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
      <SectionHeader title={UI_LABELS.autoMode} description={t('misc.auto.desc')} />

      {state?.policyDisabled && (
        <div role="status" className="mb-5 flex items-start gap-3 rounded-xl border border-accent/30 bg-accent-soft px-4 py-3 text-xs">
          <ShieldCheck size={16} className="mt-0.5 shrink-0 text-accent" aria-hidden />
          <div className="min-w-0 text-muted">
            <div className="text-sm font-medium text-fg">{t('misc.managedTitle')}</div>
            <p className="mt-0.5">{t('misc.auto.orgOff')}</p>
          </div>
        </div>
      )}

      <Card>
        <Row
          label={
            <span className="flex items-center gap-2">
              <Zap size={14} className="text-accent" /> {t('misc.auto.master')}
            </span>
          }
          description={t('misc.auto.masterDesc')}
        >
          <Toggle
            checked={enabled}
            onChange={(v) => run('enabled', () => cw('tasks:auto:set', { enabled: v }))}
            label={UI_LABELS.autoMode}
            disabled={busy === 'enabled' || state?.policyDisabled}
          />
        </Row>
      </Card>

      <SubTitle>{t('misc.auto.neverTitle')}</SubTitle>
      <Card className="px-4 py-3 text-xs text-muted">
        <ul className="list-disc space-y-1 pl-4">
          <li>{t('misc.auto.never1')}</li>
          <li>
            {t('misc.auto.never2.pre')}
            <code className="font-mono">rm</code>, <code className="font-mono">mv</code>
            {t('misc.auto.never2.or')}
            <code className="font-mono">find -delete</code>
            {t('misc.auto.never2.post')}
          </li>
          <li>{t('misc.auto.never3')}</li>
          <li>{t('misc.auto.never4')}</li>
          <li>{t('misc.auto.never5')}</li>
          <li>{t('misc.auto.never6')}</li>
          <li>{t('misc.auto.never7')}</li>
        </ul>
      </Card>

      <SubTitle>{t('misc.auto.foldersTitle')}</SubTitle>
      <Card>
        {folders.length === 0 ? (
          <Row label={t('misc.auto.noFolders')} description={t('misc.auto.noFoldersDesc')} />
        ) : (
          folders.map((f) => (
            <Row key={f.path} label={f.name} description={<span className="font-mono break-all">{f.path}</span>}>
              {busy === `folder:${f.path}` ? (
                <Loader2 size={14} className="animate-spin text-muted" />
              ) : (
                <Toggle
                  checked={settings?.folders.includes(f.path) === true}
                  onChange={(v) => toggleFolder(f.path, v)}
                  label={t('misc.auto.folderAria', { name: f.name })}
                  disabled={!enabled}
                />
              )}
            </Row>
          ))
        )}
      </Card>

      {(settings?.tasks.length ?? 0) > 0 && (
        <>
          <SubTitle>{t('misc.auto.tasksTitle')}</SubTitle>
          <Card>
            {settings?.tasks.map((sessionId) => (
              <Row
                key={sessionId}
                label={
                  <span className="flex items-center gap-1.5">
                    <FolderClosed size={12} className="text-subtle" /> {taskMeta[sessionId]?.title || t('misc.auto.taskFallback')}
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
                  <Trash2 size={12} /> {t('misc.remove')}
                </button>
              </Row>
            ))}
          </Card>
        </>
      )}

      <SubTitle>{t('misc.auto.appsTitle')}</SubTitle>
      <Card>
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <TextInput
            value={newApp}
            onChange={(e) => setNewApp(e.target.value)}
            onKeyDown={(e) => isSubmitKey(e, { allowShift: true }) && addViewApp()}
            placeholder={t('misc.auto.appPlaceholder')}
            aria-label={t('misc.auto.appAria')}
            className="max-w-xs font-mono"
          />
          <button
            type="button"
            onClick={addViewApp}
            disabled={!newApp.trim()}
            className="flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium hover:bg-hover disabled:pointer-events-none disabled:opacity-50"
          >
            <Plus size={13} /> {t('misc.add')}
          </button>
        </div>
        {(settings?.viewApps.length ?? 0) === 0 ? (
          <Row label={t('misc.auto.noApps')} description={t('misc.auto.noAppsDesc')} />
        ) : (
          settings?.viewApps.map((bundleId) => (
            <Row key={bundleId} label={appLabel(bundleId)} description={<span className="font-mono">{bundleId}</span>}>
              <button
                type="button"
                onClick={() => removeViewApp(bundleId)}
                className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-danger hover:bg-danger/10"
              >
                <Trash2 size={13} /> {t('misc.remove')}
              </button>
            </Row>
          ))
        )}
        <p className="border-t border-border px-4 py-2.5 text-xs text-subtle">{t('misc.auto.appsNote')}</p>
      </Card>

      <SubTitle>{t('misc.auto.logTitle')}</SubTitle>
      <Card>
        <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-2.5">
          <span className="text-xs text-muted">
            {log.length === 0 ? t('misc.auto.logEmpty') : t('misc.auto.logCount', { count: log.length })}
          </span>
          <button
            type="button"
            onClick={clearLog}
            disabled={log.length === 0 || busy === 'clearLog'}
            className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-danger hover:bg-danger/10 disabled:pointer-events-none disabled:opacity-40"
          >
            {busy === 'clearLog' ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />} {t('misc.auto.clearLog')}
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
                {r.revokedAt && <span className="text-danger">{t('misc.auto.revokedMark')}</span>}
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
                {busy === `revoke:${r.id}` ? <Loader2 size={12} className="animate-spin" /> : null} {t('misc.auto.revoke')}
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
        <Badge tone="muted">{t('misc.auto.rulesOnly')}</Badge> {t('misc.auto.rulesOnlyDesc')}
      </p>
    </div>
  )
}
