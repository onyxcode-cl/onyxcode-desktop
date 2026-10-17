import { useEffect, useState } from 'react'
import { Check, Monitor, Moon, RotateCw, Sun } from 'lucide-react'
import type { ThemePreference } from '@shared/types'
import { Button } from '../../../components/Button'
import { confirmDialog } from '../../../components/ConfirmDialog'
import { MODE_LABELS } from '@shared/labels'
import type { LangPref, MsgKey } from '@shared/i18n'
import { ACCENTS, applyAccent, getAccent, type AccentId } from '../../../lib/accent'
import { useT } from '../../../lib/i18n'
import { READING_MODES, useReadingMode, useWorkView, type ReadingMode, type WorkSurface } from '../../../lib/reading-mode'
import { applyTextSize, getTextSize, TEXT_SIZES, type TextSizeId } from '../../../lib/text-size'
import { cw, hasTasksBridge } from '../../tasks/impl/bridge'
import { isRemoteSurface, platformCaps } from '../../../lib/platform'
import { PlatformNote } from '../../../components/PlatformNote'
import { UI_LABELS } from '@shared/labels'
import { loadPendingLearned, subscribePendingLearned, usePendingLearned } from '../../routines/impl/pending-store'
import { useServer } from '../../../stores/server'
import { useSettings } from '../../../stores/settings'
import { useUi } from '../../../stores/ui'
import { useExtrasPrefs } from './extras'
import { firstStepsVisible } from '@shared/first-steps'
import { useFirstSteps } from '../../../stores/first-steps'
import { useShareCommandOutput } from '../../code/impl/terminal-output'
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

/** Fila «Primeros pasos»: vuelve a mostrar (o a ocultar) la lista corta de la barra lateral. */
function FirstStepsRow(): React.JSX.Element {
  const t = useT()
  const state = useFirstSteps((s) => s.state)
  const shown = firstStepsVisible(state)
  return (
    <Row label={t('settings.general.firstSteps.label')} description={t('settings.general.firstSteps.description')}>
      <Toggle
        checked={shown}
        onChange={(v) => (v ? useFirstSteps.getState().show() : useFirstSteps.getState().hide())}
        label={t('settings.general.firstSteps.label')}
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
    <div className="relative h-16 w-full overflow-hidden rounded-lg border border-border/70 desk:h-[72px] desk:rounded-ctl desk:border-0 desk:shadow-[inset_0_0_0_1px_var(--border)]">
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

/**
 * «Aprender de las tareas» (decisión del dueño, 2026-10-07): el agente puede PROPONER memoria, pero nunca se
 * guarda nada sin aprobar la tarjeta. Este interruptor solo decide si puede proponer; borrar toda la memoria
 * global es aparte, con confirmación (`confirmDialog`, igual que otras acciones destructivas de Ajustes).
 */
function LearningRow(): React.JSX.Element {
  const t = useT()
  const learningEnabled = useSettings((s) => s.settings.learningEnabled)
  const update = useSettings((s) => s.update)
  const [clearing, setClearing] = useState(false)
  const pendingCount = usePendingLearned((s) => s.state.items.length)

  useEffect(() => {
    if (!hasTasksBridge()) return
    void loadPendingLearned()
    return subscribePendingLearned()
  }, [])

  const clearGlobal = async (): Promise<void> => {
    const ok = await confirmDialog({
      title: t('tasks.learn.clearGlobalTitle'),
      message: t('tasks.learn.clearGlobalMsg'),
      confirmLabel: t('tasks.learn.clearGlobal'),
      danger: true
    })
    if (!ok) return
    setClearing(true)
    try {
      await cw('tasks:learn:clear', { alcance: 'usuario' })
    } finally {
      setClearing(false)
    }
  }

  return (
    <Row label={t('tasks.learn.settingsToggle')} description={t('tasks.learn.settingsDesc')}>
      <div className="flex items-center gap-2">
        {pendingCount > 0 && (
          <button
            type="button"
            onClick={() => useUi.getState().setMode('routines')}
            className="text-xs font-medium text-accent hover:underline"
          >
            {t('tasks.learn.pendingLink', { count: pendingCount })}
          </button>
        )}
        <Button onClick={() => void clearGlobal()} disabled={clearing}>
          {t('tasks.learn.clearGlobal')}
        </Button>
        <Toggle checked={learningEnabled} onChange={(v) => void update({ learningEnabled: v })} label={t('tasks.learn.settingsToggle')} />
      </div>
    </Row>
  )
}

export function GeneralSection(): React.JSX.Element {
  const t = useT()
  const { settings, update } = useSettings()
  const { status, connection, restart } = useServer()
  const showTray = useExtrasPrefs((s) => s.prefs.showTray)
  const shareOutput = useShareCommandOutput((s) => s.on)
  const setShareOutput = useShareCommandOutput((s) => s.set)
  const notificationsEnabled = useExtrasPrefs((s) => s.prefs.notificationsEnabled)
  const soundEnabled = useExtrasPrefs((s) => s.prefs.soundEnabled)
  const updatePrefs = useExtrasPrefs((s) => s.update)
  const st = STATE[status.state] ?? STATE.stopped
  const caps = platformCaps()
  // Celular (PWA): solo tema e idioma. Bandeja, avisos y sonido son del Mac; reiniciar el servidor y las instrucciones globales
  // son acciones que se confirman en el Mac, y no se ofrecen aquí.
  const phone = isRemoteSurface()

  return (
    <div>
      {!phone && <SectionHeader title={t('settings.general.title')} description={t('settings.general.subtitle')} />}

      <h3 className="mb-3 text-[11.5px] desk:text-meta font-semibold tracking-[0.06em] text-subtle uppercase desk:normal-case desk:mt-8 desk:mb-2.5 desk:text-[11px] desk:leading-4 desk:tracking-[0.02em]">
        {t('settings.general.theme')}
      </h3>
      <div className="grid grid-cols-3 gap-2 desk:gap-3">
        {THEMES.map(({ id, labelKey, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => void update({ theme: id })}
            aria-pressed={settings.theme === id}
            className={`group flex flex-col gap-2 rounded-xl border p-2 text-sm transition-[border-color,box-shadow,background-color] desk:border-transparent desk:pb-2.5 desk:shadow-raised ${settings.theme === id ? 'border-accent bg-accent-soft/50 shadow-[0_0_0_3px_var(--accent-ring)] desk:bg-accent-soft desk:shadow-[inset_0_0_0_1.5px_var(--accent)]' : 'border-border hover:border-border-strong hover:bg-hover/50 desk:bg-elevated desk:hover:bg-hover'}`}
          >
            <ThemePreview kind={id} />
            <span className="flex items-center justify-center gap-1.5 pb-0.5 desk:text-[13px] desk:font-medium">
              <Icon size={14} className={settings.theme === id ? 'text-accent' : 'text-muted'} />
              {t(labelKey)}
            </span>
          </button>
        ))}
      </div>
      {phone && <p className="mt-2 px-1 text-[13px] leading-snug text-muted">{t('mobile.settings.sharedHint')}</p>}
      {!phone && <AccentPicker />}
      {!phone && <TextSizePicker />}
      {!phone && <WorkViewPicker />}

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
        {!phone && (
          <>
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
            <Row label={t('settings.general.shareOutput.label')} description={t('settings.general.shareOutput.description')}>
              <Toggle checked={shareOutput} onChange={setShareOutput} label={t('settings.general.shareOutput.label')} />
            </Row>
            <Row label={t('settings.general.sound.label')} description={t('settings.general.sound.description')}>
              <Toggle
                checked={soundEnabled}
                onChange={(v) => void updatePrefs({ soundEnabled: v })}
                label={t('settings.general.sound.label')}
                disabled={!notificationsEnabled}
              />
            </Row>
          </>
        )}
        {!phone && <FirstStepsRow />}
        {caps.tasks && <KeepAwakeRow />}
      </Card>
      {phone && <p className="mt-2 px-1 text-[13px] leading-snug text-muted">{t('mobile.settings.sharedHint')}</p>}

      {phone ? null : caps.tasks ? (
        <>
          <SubTitle>{MODE_LABELS.tasks}</SubTitle>
          <Card>
            <TasksInstructionsRow />
            <LearningRow />
          </Card>
        </>
      ) : (
        <div className="mt-6">
          <PlatformNote title={t('platform.win.unavailable.title')}>
            <ul className="list-disc space-y-1 pl-4">
              <li>{t('platform.win.unavailable.tasks', { tasks: MODE_LABELS.tasks })}</li>
              <li>{t('platform.win.unavailable.computer', { computer: UI_LABELS.computer, tasks: MODE_LABELS.tasks })}</li>
              <li>{t('platform.win.unavailable.update')}</li>
            </ul>
          </PlatformNote>
        </div>
      )}

      {!phone && <SubTitle>{t('settings.general.server')}</SubTitle>}
      {!phone && (
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
      )}
      {!phone && status.error && (
        <div className="mt-3">
          <ErrorText>{status.error}</ErrorText>
        </div>
      )}
    </div>
  )
}

/** Color de acento: cinco opciones, se aplica al instante y se recuerda en este equipo. */
function AccentPicker(): React.JSX.Element {
  const t = useT()
  const [accent, setAccent] = useState<AccentId>(getAccent)
  const names: Record<AccentId, MsgKey> = {
    blue: 'settings.general.accent.blue',
    violet: 'settings.general.accent.violet',
    green: 'settings.general.accent.green',
    teal: 'settings.general.accent.teal',
    rose: 'settings.general.accent.rose'
  }
  return (
    <>
      <h3 className="mt-6 mb-3 text-[11.5px] desk:text-meta font-semibold tracking-[0.06em] text-subtle uppercase desk:normal-case desk:mb-2.5 desk:text-[11px] desk:leading-4 desk:tracking-[0.02em]">
        {t('settings.general.accent')}
      </h3>
      <div role="radiogroup" aria-label={t('settings.general.accent')} className="flex flex-wrap gap-2.5">
        {ACCENTS.map(({ id, swatch }) => (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={accent === id}
            title={t(names[id])}
            onClick={() => {
              setAccent(id)
              applyAccent(id, true)
            }}
            className={`flex h-8 w-8 items-center justify-center rounded-full ring-offset-2 ring-offset-[var(--bg)] transition ${accent === id ? 'ring-2 ring-fg' : 'hover:ring-2 hover:ring-border-strong'}`}
            style={{ backgroundColor: swatch }}
          >
            {accent === id && <Check size={14} className="text-white" aria-hidden />}
          </button>
        ))}
      </div>
    </>
  )
}

/** Tamaño del texto: tres opciones, se aplica al instante y se recuerda en este equipo. */
function TextSizePicker(): React.JSX.Element {
  const t = useT()
  const [size, setSize] = useState<TextSizeId>(getTextSize)
  const names: Record<TextSizeId, MsgKey> = {
    small: 'settings.general.textSize.small',
    normal: 'settings.general.textSize.normal',
    large: 'settings.general.textSize.large'
  }
  return (
    <>
      <h3 className="mt-6 mb-3 text-[11.5px] desk:text-meta font-semibold tracking-[0.06em] text-subtle uppercase desk:normal-case desk:mb-2.5 desk:text-[11px] desk:leading-4 desk:tracking-[0.02em]">
        {t('settings.general.textSize')}
      </h3>
      <div role="radiogroup" aria-label={t('settings.general.textSize')} className="inline-flex gap-1 rounded-xl bg-hover/60 p-1">
        {TEXT_SIZES.map(({ id }) => (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={size === id}
            onClick={() => {
              setSize(id)
              applyTextSize(id, true)
            }}
            className={`rounded-lg px-4 py-1.5 text-sm transition ${size === id ? 'bg-elevated font-medium text-fg shadow-sm' : 'text-muted hover:text-fg'}`}
          >
            {t(names[id])}
          </button>
        ))}
      </div>
    </>
  )
}

/** Vista del trabajo del agente: cuánto se ve de lo que hizo en cada respuesta, por separado en Chat y en Code/Overdrive. */
function WorkViewPicker(): React.JSX.Element {
  const t = useT()
  const rows: Array<{ surface: WorkSurface; label: MsgKey }> = [
    { surface: 'chat', label: 'settings.general.workView.chat' },
    { surface: 'code', label: 'settings.general.workView.code' }
  ]
  return (
    <>
      <h3 className="mt-6 mb-1 text-[11.5px] desk:text-meta font-semibold tracking-[0.06em] text-subtle uppercase desk:normal-case desk:mb-1 desk:text-[11px] desk:leading-4 desk:tracking-[0.02em]">
        {t('settings.general.workView')}
      </h3>
      <p className="mb-2.5 max-w-xl text-xs text-muted">{t('settings.general.workView.hint')}</p>
      <div className="flex flex-col gap-2.5">
        {rows.map(({ surface, label }) => (
          <WorkViewRow key={surface} surface={surface} label={t(label)} />
        ))}
      </div>
    </>
  )
}

function WorkViewRow({ surface, label }: { surface: WorkSurface; label: string }): React.JSX.Element {
  const t = useT()
  const mode = useWorkView(surface)
  return (
    <div className="flex flex-wrap items-center gap-3">
      <span className="w-40 shrink-0 text-sm">{label}</span>
      <div role="radiogroup" aria-label={label} className="inline-flex gap-1 rounded-xl bg-hover/60 p-1">
        {READING_MODES.map((id: ReadingMode) => (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={mode === id}
            onClick={() => useReadingMode.getState().setView(surface, id)}
            className={`rounded-lg px-3 py-1.5 text-sm transition ${mode === id ? 'bg-elevated font-medium text-fg shadow-sm' : 'text-muted hover:text-fg'}`}
          >
            {t(`code.reading.${id}` as const)}
          </button>
        ))}
      </div>
    </div>
  )
}
