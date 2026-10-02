import { useEffect, useState } from 'react'
import { Monitor, Moon, RotateCw, Sun } from 'lucide-react'
import type { ThemePreference } from '@shared/types'
import { Button } from '../../../components/Button'
import { MODE_LABELS } from '@shared/labels'
import type { LangPref, MsgKey } from '@shared/i18n'
import { useT } from '../../../lib/i18n'
import { cw, hasTasksBridge } from '../../tasks/impl/bridge'
import { platformCaps } from '../../../lib/platform'
import { PlatformNote } from '../../../components/PlatformNote'
import { UI_LABELS } from '@shared/labels'
import { useServer } from '../../../stores/server'
import { useSettings } from '../../../stores/settings'
import { useExtrasPrefs } from './extras'
import { Badge, Card, ErrorText, Row, SectionHeader, Select, SubTitle, Toggle } from './ui'

/** Fila "Mantener el Mac despierto mientras corren tareas" (powerSaveBlocker en main). */
function KeepAwakeRow(): React.JSX.Element | null {
  const t = useT()
  const [enabled, setEnabled] = useState<boolean | null>(null)

  useEffect(() => {
    if (!hasTasksBridge()) return
    cw('tasks:keepAwakeState')
      .then((st) => setEnabled(st.enabled))
      .catch(() => undefined)
  }, [])

  if (!hasTasksBridge() || enabled === null) return null

  return (
    <Row label={t('settings.general.keepAwake.label')} description={t('settings.general.keepAwake.description')}>
      <Toggle
        checked={enabled}
        onChange={(v) => {
          setEnabled(v)
          void cw('tasks:keepAwakeSetting', { enabled: v }).catch(() => undefined)
        }}
        label={t('settings.general.keepAwake.toggle')}
      />
    </Row>
  )
}

const THEMES: { id: ThemePreference; labelKey: MsgKey; icon: typeof Sun }[] = [
  { id: 'system', labelKey: 'settings.general.theme.system', icon: Monitor },
  { id: 'light', labelKey: 'settings.general.theme.light', icon: Sun },
  { id: 'dark', labelKey: 'settings.general.theme.dark', icon: Moon }
]

const STATE: Record<string, { labelKey: MsgKey; tone: 'ok' | 'warn' | 'error' | 'muted' }> = {
  stopped: { labelKey: 'settings.general.state.stopped', tone: 'muted' },
  starting: { labelKey: 'settings.general.state.starting', tone: 'warn' },
  ready: { labelKey: 'settings.general.state.ready', tone: 'ok' },
  error: { labelKey: 'settings.general.state.error', tone: 'error' }
}

const LANGUAGE_OPTIONS: { id: LangPref; labelKey: MsgKey }[] = [
  { id: 'system', labelKey: 'settings.general.language.system' },
  { id: 'es', labelKey: 'settings.general.language.es' },
  { id: 'en', labelKey: 'settings.general.language.en' }
]

/** Mini-maqueta de la ventana en cada tema (colores literales: deben verse aunque el tema activo sea otro). */
function ThemePreview({ kind }: { kind: ThemePreference }): React.JSX.Element {
  const light = { bg: '#f7f8fb', side: '#eff1f6', line: '#dde2ee', accent: '#2c4fd8', bubble: '#e8ecf8' }
  const dark = { bg: '#11131a', side: '#0c0e14', line: '#292e3c', accent: '#7d97ff', bubble: '#1e2331' }
  const pane = (c: typeof light): React.JSX.Element => (
    <div className="flex h-full w-full" style={{ background: c.bg }}>
      <div className="flex w-[30%] flex-col gap-1 p-1.5" style={{ background: c.side }}>
        <div className="h-1.5 w-3 rounded-full" style={{ background: c.accent }} />
        <div className="h-1 w-full rounded-full" style={{ background: c.line }} />
        <div className="h-1 w-3/4 rounded-full" style={{ background: c.line }} />
      </div>
      <div className="flex flex-1 flex-col justify-end gap-1 p-1.5">
        <div className="ml-auto h-2 w-1/2 rounded" style={{ background: c.bubble }} />
        <div className="h-1 w-3/4 rounded-full" style={{ background: c.line }} />
        <div className="h-1 w-1/2 rounded-full" style={{ background: c.line }} />
      </div>
    </div>
  )
  return (
    <div className="relative h-16 w-full overflow-hidden rounded-lg border border-border/70">
      {kind === 'dark' ? pane(dark) : pane(light)}
      {kind === 'system' && (
        <div className="absolute inset-0" style={{ clipPath: 'polygon(55% 0, 100% 0, 100% 100%, 45% 100%)' }}>
          {pane(dark)}
        </div>
      )}
    </div>
  )
}

/** Instrucciones globales de las tareas (item 1): se añaden a todas las tareas, junto con las de cada proyecto. */
function TasksInstructionsRow(): React.JSX.Element {
  const t = useT()
  const globalInstructions = useSettings((s) => s.settings.tasksGlobalInstructions)
  const update = useSettings((s) => s.update)
  const [value, setValue] = useState(globalInstructions)
  const [saved, setSaved] = useState(false)

  useEffect(() => setValue(globalInstructions), [globalInstructions])

  const save = (): void => {
    if (value === globalInstructions) return
    void update({ tasksGlobalInstructions: value }).then(() => {
      setSaved(true)
      setTimeout(() => setSaved(false), 1200)
    })
  }

  return (
    <Row label={t('settings.general.instructions.label')} description={t('settings.general.instructions.description')}>
      <div className="w-full max-w-md">
        <textarea
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onBlur={save}
          maxLength={20_000}
          placeholder={t('settings.general.instructions.placeholder')}
          className="min-h-20 w-full resize-y rounded-lg border border-border bg-bg px-3 py-2 text-sm outline-none transition focus:border-border-strong focus:ring-2 focus:ring-accent/15 placeholder:text-subtle"
        />
        {saved && <p className="mt-1 text-xs text-accent">{t('settings.general.saved')}</p>}
      </div>
    </Row>
  )
}

export function GeneralSection(): React.JSX.Element {
  const t = useT()
  const { settings, update } = useSettings()
  const { status, connection, restart } = useServer()
  const showTray = useExtrasPrefs((s) => s.prefs.showTray)
  const notificationsEnabled = useExtrasPrefs((s) => s.prefs.notificationsEnabled)
  const soundEnabled = useExtrasPrefs((s) => s.prefs.soundEnabled)
  const updatePrefs = useExtrasPrefs((s) => s.update)
  const st = STATE[status.state] ?? STATE.stopped
  const caps = platformCaps()

  return (
    <div>
      <SectionHeader title={t('settings.general.title')} description={t('settings.general.subtitle')} />

      <h3 className="mb-3 text-[11.5px] font-semibold tracking-[0.06em] text-subtle uppercase">{t('settings.general.theme')}</h3>
      <div className="grid grid-cols-3 gap-2">
        {THEMES.map(({ id, labelKey, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => void update({ theme: id })}
            aria-pressed={settings.theme === id}
            className={`group flex flex-col gap-2 rounded-xl border p-2 text-sm transition-[border-color,box-shadow,background-color] ${settings.theme === id ? 'border-accent bg-accent-soft/50 shadow-[0_0_0_3px_var(--accent-ring)]' : 'border-border hover:border-border-strong hover:bg-hover/50'}`}
          >
            <ThemePreview kind={id} />
            <span className="flex items-center justify-center gap-1.5 pb-0.5">
              <Icon size={14} className={settings.theme === id ? 'text-accent' : 'text-muted'} />
              {t(labelKey)}
            </span>
          </button>
        ))}
      </div>

      <SubTitle>{t('settings.general.preferences')}</SubTitle>
      <Card>
        <Row label={t('settings.general.language')} description={t('settings.general.language.description')}>
          <Select
            value={settings.language}
            onChange={(e) => void update({ language: e.target.value as LangPref })}
            aria-label={t('settings.general.language')}
            className="w-40"
          >
            {LANGUAGE_OPTIONS.map((o) => (
              <option key={o.id} value={o.id}>
                {t(o.labelKey)}
              </option>
            ))}
          </Select>
        </Row>
        <Row label={t('settings.general.tray.label')} description={t('settings.general.tray.description')}>
          <Toggle checked={showTray} onChange={(v) => void updatePrefs({ showTray: v })} label={t('settings.general.tray.label')} />
        </Row>
        <Row label={t('settings.general.notifications.label')} description={t('settings.general.notifications.description')}>
          <Toggle
            checked={notificationsEnabled}
            onChange={(v) => void updatePrefs({ notificationsEnabled: v })}
            label={t('settings.general.notifications.label')}
          />
        </Row>
        <Row label={t('settings.general.sound.label')} description={t('settings.general.sound.description')}>
          <Toggle
            checked={soundEnabled}
            onChange={(v) => void updatePrefs({ soundEnabled: v })}
            label={t('settings.general.sound.label')}
            disabled={!notificationsEnabled}
          />
        </Row>
        {caps.keepAwakeText && <KeepAwakeRow />}
      </Card>

      {caps.tasks ? (
        <>
          <SubTitle>{MODE_LABELS.tasks}</SubTitle>
          <Card>
            <TasksInstructionsRow />
          </Card>
        </>
      ) : (
        <div className="mt-6">
          <PlatformNote title={t('platform.win.unavailable.title')}>
            <ul className="list-disc space-y-1 pl-4">
              <li>{t('platform.win.unavailable.tasks', { tasks: MODE_LABELS.tasks })}</li>
              <li>{t('platform.win.unavailable.computer', { computer: UI_LABELS.computer })}</li>
              <li>{t('platform.win.unavailable.update')}</li>
            </ul>
          </PlatformNote>
        </div>
      )}

      <SubTitle>{t('settings.general.server')}</SubTitle>
      <Card>
        <Row
          label={
            <span className="flex items-center gap-2">
              {t('settings.general.server.status')} <Badge tone={st.tone}>{t(st.labelKey)}</Badge>
            </span>
          }
          description={
            <>
              {status.version && <span>v{status.version}</span>}
              {connection && <span className="ml-2 font-mono">{connection.baseUrl}</span>}
              {status.restarts > 0 && <span className="ml-2">{t('settings.general.server.restarts', { count: status.restarts })}</span>}
            </>
          }
        >
          <Button onClick={() => void restart()}>
            <RotateCw size={14} /> {t('settings.general.server.restart')}
          </Button>
        </Row>
      </Card>
      {status.error && (
        <div className="mt-3">
          <ErrorText>{status.error}</ErrorText>
        </div>
      )}
    </div>
  )
}
