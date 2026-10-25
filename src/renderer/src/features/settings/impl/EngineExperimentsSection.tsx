/**
 * Ajustes › Funciones experimentales: interruptores por modo (Chat, Code, Overdrive) de Modo código y de
 * subagentes en segundo plano. Solo escribe `Settings.engineExperiments` (objeto completo); aplicar el cambio
 * (reinicio del motor cuando no hay nada en curso) lo hace el proceso principal.
 */
import { useId } from 'react'
import { normalizeEngineExperiments, type EngineExperimentMode } from '@shared/engine-experiments'
import { t as tr } from '@shared/i18n'
import { MODE_LABELS } from '@shared/labels'
import type { EngineExperiments } from '@shared/types'
import { useT } from '../../../lib/i18n'
import { useSettings } from '../../../stores/settings'
import { EngineLimitsBlock } from './EngineLimitsBlock'
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
      toolSearch: { ...current.toolSearch }
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
        toolSearch: { ...current.toolSearch, [mode]: on ? 'auto' : 'off' }
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
      <RememberAlwaysBlock />
      <UserHooksBlock />
      <EngineLimitsBlock />
      <p className="text-xs leading-relaxed text-muted">{t('settings.engine.sharedNote')}</p>
    </div>
  )
}
