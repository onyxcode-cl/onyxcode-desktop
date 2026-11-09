/**
 * Ajustes › Funciones experimentales: interruptores por modo (Chat, Code, Overdrive) de Modo código y de
 * subagentes en segundo plano. Solo escribe `Settings.engineExperiments` (objeto completo); aplicar el cambio
 * (reinicio del motor cuando no hay nada en curso) lo hace el proceso principal.
 */
import { useEffect, useId, useState } from 'react'
import { normalizeEngineExperiments, type EngineExperimentMode } from '@shared/engine-experiments'
import { t as tr, type MsgKey } from '@shared/i18n'
import { MODE_LABELS } from '@shared/labels'
import type { CodeExtrasFlags, EngineExperiments } from '@shared/types'
import { call } from '../../../lib/api'
import { useT } from '../../../lib/i18n'
import { useSettings } from '../../../stores/settings'
import { EngineLimitsBlock } from './EngineLimitsBlock'
import { AlwaysRulesBlock } from './AlwaysRulesBlock'
import { RememberAlwaysBlock } from './RememberAlwaysBlock'
import { UserHooksBlock } from './UserHooksBlock'
import { Badge, Card, Row, SectionHeader, Toggle } from './ui'

type Feature = 'codeMode' | 'backgroundSubagents'

const MODES: readonly EngineExperimentMode[] = ['chat', 'code', 'tasks']

function modeLabel(mode: EngineExperimentMode): string {
  return mode === 'chat' ? MODE_LABELS.chat : mode === 'code' ? MODE_LABELS.code : MODE_LABELS.tasks
}

function FeatureBlock({
  feature,
  title,
  desc,
  change,
  chatNote
}: {
  feature: Feature
  title: string
  desc: string
  change: string
  /** Qué significa esta función en el Chat (F8-B206). */
  chatNote: string
}): React.JSX.Element {
  const t = useT()
  const id = useId()
  const stored = useSettings((s) => s.settings.engineExperiments)
  const update = useSettings((s) => s.update)
  const current = normalizeEngineExperiments(stored)

  const set = (mode: EngineExperimentMode, on: boolean): void => {
    const next: EngineExperiments = {
      codeMode: { ...current.codeMode },
      backgroundSubagents: { ...current.backgroundSubagents },
      toolSearch: { ...current.toolSearch },
      mcpElicitation: { ...current.mcpElicitation },
      codeExtras: { ...current.codeExtras }
    }
    next[feature][mode] = on
    void update({ engineExperiments: next })
  }

  return (
    <section role="group" aria-labelledby={`${id}-t`} aria-describedby={`${id}-d`} className="mb-8">
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <h3 id={`${id}-t`} className="text-sm font-semibold">
          {title}
        </h3>
        <Badge tone="muted">{t('settings.engine.experimental')}</Badge>
      </div>
      <p id={`${id}-d`} className="mb-1 text-sm leading-relaxed text-muted">
        {desc}
      </p>
      <p className="mb-1 text-xs leading-relaxed text-muted">{change}</p>
      <p className="mb-3 text-xs leading-relaxed text-muted">{chatNote}</p>
      <Card>
        <div role="group" aria-label={t('settings.engine.modesAria')}>
          {MODES.map((mode) => (
            <Row key={mode} label={modeLabel(mode)}>
              <Toggle
                checked={current[feature][mode]}
                onChange={(v) => set(mode, v)}
                label={tr('settings.engine.toggleAria', { feature: title, mode: modeLabel(mode) })}
              />
            </Row>
          ))}
        </div>
      </Card>
    </section>
  )
}

/**
 * Búsqueda diferida de herramientas de conectores. Aparte de `FeatureBlock` porque su valor es `auto`/`off` (no booleano) y Overdrive
 * (Tareas) queda siempre apagado: solo Chat y Code tienen interruptor. Encendido = `auto` (el motor decide por tamaño).
 */
function ToolSearchBlock(): React.JSX.Element {
  const t = useT()
  const id = useId()
  const stored = useSettings((s) => s.settings.engineExperiments)
  const update = useSettings((s) => s.update)
  const current = normalizeEngineExperiments(stored)
  const set = (mode: 'chat' | 'code', on: boolean): void => {
    void update({
      engineExperiments: {
        codeMode: { ...current.codeMode },
        backgroundSubagents: { ...current.backgroundSubagents },
        toolSearch: { ...current.toolSearch, [mode]: on ? 'auto' : 'off' },
        mcpElicitation: { ...current.mcpElicitation },
        codeExtras: { ...current.codeExtras }
      }
    })
  }
  return (
    <section role="group" aria-labelledby={`${id}-t`} aria-describedby={`${id}-d`} className="mb-8">
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <h3 id={`${id}-t`} className="text-sm font-semibold">
          {t('settings.engine.toolSearch.title')}
        </h3>
        <Badge tone="muted">{t('settings.engine.experimental')}</Badge>
      </div>
      <p id={`${id}-d`} className="mb-1 text-sm leading-relaxed text-muted">
        {t('settings.engine.toolSearch.desc')}
      </p>
      <p className="mb-1 text-xs leading-relaxed text-muted">{t('settings.engine.toolSearch.change')}</p>
      <p className="mb-3 text-xs leading-relaxed text-muted">{t('settings.engine.toolSearch.chatNote')}</p>
      <Card>
        <div role="group" aria-label={t('settings.engine.modesAria')}>
          {(['chat', 'code'] as const).map((mode) => (
            <Row key={mode} label={modeLabel(mode)}>
              <Toggle
                checked={current.toolSearch[mode] === 'auto'}
                onChange={(v) => set(mode, v)}
                label={tr('settings.engine.toolSearch.toggleAria', { mode: modeLabel(mode) })}
              />
            </Row>
          ))}
        </div>
      </Card>
    </section>
  )
}

/** Modos con formularios de conectores: Overdrive nunca (no hay nadie delante para contestarlos). */
const FORM_MODES: readonly EngineExperimentMode[] = ['chat', 'code']

/** «Formularios de conectores»: un interruptor por modo (solo Chat y Code). Encendido por defecto; ver `docs/SEGURIDAD.md`. */
function FormsBlock(): React.JSX.Element {
  const t = useT()
  const id = useId()
  const stored = useSettings((s) => s.settings.engineExperiments)
  const update = useSettings((s) => s.update)
  const current = normalizeEngineExperiments(stored)
  const title = t('settings.engine.forms.title')

  const set = (mode: EngineExperimentMode, on: boolean): void => {
    const next: EngineExperiments = {
      codeMode: { ...current.codeMode },
      backgroundSubagents: { ...current.backgroundSubagents },
      toolSearch: { ...current.toolSearch },
      mcpElicitation: { ...current.mcpElicitation, [mode]: on, tasks: false },
      codeExtras: { ...current.codeExtras }
    }
    void update({ engineExperiments: next })
  }

  return (
    <section aria-labelledby={`${id}-t`} aria-describedby={`${id}-d`} className="mb-8">
      <h3 id={`${id}-t`} className="mb-1 text-sm font-semibold">
        {title}
      </h3>
      <p id={`${id}-d`} className="mb-1 text-sm leading-relaxed text-muted">
        {t('settings.engine.forms.desc')}
      </p>
      <p className="mb-1 text-xs leading-relaxed text-muted">{t('settings.engine.forms.change')}</p>
      <p className="mb-3 text-xs leading-relaxed text-muted">{t('settings.engine.forms.note')}</p>
      <Card>
        <div role="group" aria-label={t('settings.engine.modesAria')}>
          {FORM_MODES.map((mode) => (
            <Row key={mode} label={modeLabel(mode)}>
              <Toggle
                checked={current.mcpElicitation[mode]}
                onChange={(v) => set(mode, v)}
                label={tr('settings.engine.toggleAria', { feature: title, mode: modeLabel(mode) })}
              />
            </Row>
          ))}
        </div>
      </Card>
    </section>
  )
}

const EXTRAS: readonly { key: keyof CodeExtrasFlags; label: MsgKey; desc: MsgKey; aria: MsgKey }[] = [
  {
    key: 'goal',
    label: 'settings.engine.extras.goal.label',
    desc: 'settings.engine.extras.goal.desc',
    aria: 'settings.engine.extras.goal.aria'
  },
  {
    key: 'budget',
    label: 'settings.engine.extras.budget.label',
    desc: 'settings.engine.extras.budget.desc',
    aria: 'settings.engine.extras.budget.aria'
  },
  {
    key: 'review',
    label: 'settings.engine.extras.review.label',
    desc: 'settings.engine.extras.review.desc',
    aria: 'settings.engine.extras.review.aria'
  }
]

/** «Objetivo, presupuesto y revisión»: tres funciones de Code, APAGADAS por defecto. Aplicar no reinicia el motor (no usan variables de entorno). */
function CodeExtrasBlock(): React.JSX.Element {
  const t = useT()
  const id = useId()
  const stored = useSettings((s) => s.settings.engineExperiments)
  const update = useSettings((s) => s.update)
  const current = normalizeEngineExperiments(stored)
  const set = (key: keyof CodeExtrasFlags, on: boolean): void => {
    void update({
      engineExperiments: {
        codeMode: { ...current.codeMode },
        backgroundSubagents: { ...current.backgroundSubagents },
        toolSearch: { ...current.toolSearch },
        mcpElicitation: { ...current.mcpElicitation },
        codeExtras: { ...current.codeExtras, [key]: on }
      }
    })
  }
  return (
    <section aria-labelledby={`${id}-t`} aria-describedby={`${id}-d`} className="mb-8">
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <h3 id={`${id}-t`} className="text-sm font-semibold">
          {t('settings.engine.extras.title')}
        </h3>
        <Badge tone="muted">{t('settings.engine.experimental')}</Badge>
      </div>
      <p id={`${id}-d`} className="mb-1 text-sm leading-relaxed text-muted">
        {t('settings.engine.extras.desc')}
      </p>
      <p className="mb-3 text-xs leading-relaxed text-muted">{t('settings.engine.extras.change')}</p>
      <Card>
        {EXTRAS.map((e) => (
          <Row key={e.key} label={t(e.label)} description={t(e.desc)}>
            <Toggle checked={current.codeExtras[e.key]} onChange={(v) => set(e.key, v)} label={t(e.aria)} />
          </Row>
        ))}
      </Card>
    </section>
  )
}

/** Sha256 (hexadecimal) del texto en UTF-8, o `null` si este entorno no tiene WebCrypto. */
async function sha256OfText(text: string): Promise<string | null> {
  try {
    const subtle = globalThis.crypto?.subtle
    if (!subtle) return null
    const digest = await subtle.digest('SHA-256', new TextEncoder().encode(text))
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
  } catch {
    return null
  }
}

/**
 * Avisos de confianza de los ganchos (1.8.12). El motor solo ejecuta el archivo cuya huella guardó la app; aquí se le dice a la persona:
 *  - «Revisa tus ganchos»: al actualizar, la app dio por buenos los ganchos que ya estaban activos (decisión D11); se quita al guardar.
 *  - «Los ganchos no se están ejecutando»: el archivo ya no coincide con lo último que se guardó desde la pantalla (editado a mano o por otro
 *    programa) o nunca se guardó; el motor no ejecuta ninguno.
 * Es solo información: quien aplica la regla es el motor. Si este entorno no puede calcular la huella, no se muestra el segundo aviso.
 */
function HooksTrustNotice(): React.JSX.Element | null {
  const t = useT()
  const enabled = useSettings((s) => s.settings.userHooksEnabled === true)
  const sha = useSettings((s) => s.settings.userHooksSha256 ?? null)
  const review = useSettings((s) => s.settings.userHooksReview === true)
  const [differs, setDiffers] = useState(false)

  useEffect(() => {
    if (!enabled) return
    let alive = true
    const check = (): void => {
      let pending: Promise<{ text: string; exists: boolean }>
      try {
        pending = call('settings:hooksRead')
      } catch {
        return
      }
      pending
        .then(async (r) => {
          const actual = r.exists ? await sha256OfText(r.text) : null
          // Sin archivo no hay nada que ejecutar; sin WebCrypto no se puede comparar.
          if (alive && r.exists && actual !== null) setDiffers(sha === null || sha.toLowerCase() !== actual)
          else if (alive) setDiffers(false)
        })
        .catch(() => undefined)
    }
    check()
    // El archivo se puede editar fuera de la app mientras esta pantalla está abierta: se vuelve a mirar al volver a la ventana.
    window.addEventListener('focus', check)
    return () => {
      alive = false
      window.removeEventListener('focus', check)
    }
  }, [enabled, sha])

  if (!enabled) return null
  if (differs) {
    return (
      <div role="status" className="mb-3 rounded-md border border-border px-3 py-2 text-xs leading-relaxed">
        <p className="font-semibold">{t('settings.engine.hooks.trust.changed.title')}</p>
        <p className="mt-1 text-muted">{t('settings.engine.hooks.trust.changed.body')}</p>
      </div>
    )
  }
  if (review) {
    return (
      <div role="status" className="mb-3 rounded-md border border-border px-3 py-2 text-xs leading-relaxed">
        <p className="font-semibold">{t('settings.engine.hooks.trust.review.title')}</p>
        <p className="mt-1 text-muted">{t('settings.engine.hooks.trust.review.body')}</p>
      </div>
    )
  }
  return null
}

type LastMileKey = 'webSearchAnyProvider' | 'permissionSuggestions'

/**
 * Un interruptor único (no por modo) con su aviso siempre visible: «Búsqueda web con cualquier IA» y «Sugerencia en las tarjetas de permiso».
 * Ambos APAGADOS por defecto; cambiarlos reinicia el motor principal cuando no hay nada en curso. Overdrive no los recibe.
 */
function LastMileSwitch({
  setting,
  title,
  desc,
  warn,
  toggle
}: {
  setting: LastMileKey
  title: string
  desc: string
  warn: string
  toggle: string
}): React.JSX.Element {
  const id = useId()
  const on = useSettings((s) => s.settings[setting] === true)
  const update = useSettings((s) => s.update)
  return (
    <section aria-labelledby={`${id}-t`} aria-describedby={`${id}-d`} className="mb-8">
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <h3 id={`${id}-t`} className="text-sm font-semibold">
          {title}
        </h3>
        <Badge tone="muted">{tr('settings.engine.experimental')}</Badge>
      </div>
      <p id={`${id}-d`} className="mb-2 text-sm leading-relaxed text-muted">
        {desc}
      </p>
      <p role="note" className="mb-3 rounded-md border border-border px-3 py-2 text-xs font-medium leading-relaxed">
        {warn}
      </p>
      <Card>
        <Row label={toggle}>
          <Toggle checked={on} onChange={(v) => void update({ [setting]: v })} label={toggle} />
        </Row>
      </Card>
    </section>
  )
}

export function EngineExperimentsSection(): React.JSX.Element {
  const t = useT()
  return (
    <div>
      <SectionHeader title={t('settings.engine.title')} description={t('settings.engine.desc')} />
      <p className="mb-6 text-xs leading-relaxed text-muted">{t('settings.engine.restartNote')}</p>
      <FeatureBlock
        feature="codeMode"
        title={t('settings.engine.codeMode.title')}
        desc={t('settings.engine.codeMode.desc')}
        change={t('settings.engine.codeMode.change')}
        chatNote={t('settings.engine.codeMode.chatNote')}
      />
      <FeatureBlock
        feature="backgroundSubagents"
        title={t('settings.engine.background.title')}
        desc={t('settings.engine.background.desc')}
        change={t('settings.engine.background.change')}
        chatNote={t('settings.engine.background.chatNote')}
      />
      <ToolSearchBlock />
      <FormsBlock />
      <CodeExtrasBlock />
      <LastMileSwitch
        setting="webSearchAnyProvider"
        title={t('settings.engine.lastmile.web.title')}
        desc={t('settings.engine.lastmile.web.desc')}
        warn={t('settings.engine.lastmile.web.warn')}
        toggle={t('settings.engine.lastmile.web.toggle')}
      />
      <LastMileSwitch
        setting="permissionSuggestions"
        title={t('settings.engine.lastmile.suggest.title')}
        desc={t('settings.engine.lastmile.suggest.desc')}
        warn={t('settings.engine.lastmile.suggest.warn')}
        toggle={t('settings.engine.lastmile.suggest.toggle')}
      />
      <RememberAlwaysBlock />
      <AlwaysRulesBlock />
      <UserHooksBlock notice={<HooksTrustNotice />} />
      <EngineLimitsBlock />
      <p className="text-xs leading-relaxed text-muted">{t('settings.engine.sharedNote')}</p>
    </div>
  )
}
