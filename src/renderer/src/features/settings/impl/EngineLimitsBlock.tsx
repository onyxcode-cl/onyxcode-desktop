/**
 * Ajustes › Funciones experimentales › Límites: topes del Modo código y de los comandos en segundo plano del motor.
 * Solo escribe `Settings.engineLimits` (objeto ESCASO: solo lo que la persona cambió; un valor igual al defecto se quita, ver
 * `engine-limits.ts`). Aplicar el cambio (reinicio del motor cuando no hay nada en curso) lo hace el proceso principal.
 */
import { useEffect, useId, useState } from 'react'
import { ENGINE_LIMIT_SPEC, normalizeEngineLimits, type EngineLimitKey, type EngineLimits } from '@shared/engine-limits'
import { t as tr } from '@shared/i18n'
import { useT } from '../../../lib/i18n'
import { useSettings } from '../../../stores/settings'
import { Button } from '../../../components/Button'
import { Card, Row, TextInput } from './ui'

type Unit = 'min' | 'sec' | 'mb' | 'calls' | 'cells'

interface FieldDef {
  key: EngineLimitKey
  label: string
  desc: string
  unitLabel: string
}

function LimitField({
  def,
  stored,
  commit
}: {
  def: FieldDef
  stored: number | undefined
  commit: (key: EngineLimitKey, value: number | undefined) => void
}): React.JSX.Element {
  const id = useId()
  const spec = ENGINE_LIMIT_SPEC[def.key]
  const current = stored ?? spec.def
  const [draft, setDraft] = useState(String(current))
  // Si el valor guardado cambia desde fuera (restablecer, otro ajuste), el campo lo sigue.
  useEffect(() => setDraft(String(current)), [current])

  const finish = (): void => {
    const n = Number(draft)
    if (draft.trim() === '' || !Number.isFinite(n)) {
      setDraft(String(current))
      return
    }
    // Se acerca al rango permitido y a un entero; igual al defecto = quitarlo del almacén.
    const v = Math.min(spec.max, Math.max(spec.min, Math.round(n)))
    setDraft(String(v))
    if (v !== current) commit(def.key, v === spec.def ? undefined : v)
  }

  return (
    <Row
      label={<span id={`${id}-l`}>{def.label}</span>}
      description={
        <>
          <span id={`${id}-d`}>{def.desc}</span>{' '}
          <span>{tr('settings.engine.limits.range', { def: spec.def, min: spec.min, max: spec.max, unit: def.unitLabel })}</span>
        </>
      }
    >
      <div className="flex items-center gap-2">
        <TextInput
          type="number"
          inputMode="numeric"
          min={spec.min}
          max={spec.max}
          step={1}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={finish}
          onKeyDown={(e) => {
            if (e.key === 'Enter') finish()
          }}
          aria-label={`${def.label} (${def.unitLabel})`}
          aria-describedby={`${id}-d`}
          className="w-24 text-right"
          data-limit={def.key}
        />
        <span id={`${id}-u`} className="w-16 text-xs text-muted">
          {def.unitLabel}
        </span>
      </div>
    </Row>
  )
}

export function EngineLimitsBlock(): React.JSX.Element {
  const t = useT()
  const id = useId()
  const stored = useSettings((s) => s.settings.engineLimits)
  const update = useSettings((s) => s.update)
  const current: EngineLimits = normalizeEngineLimits(stored)
  const changed = Object.keys(current).length > 0

  const unit = (u: Unit): string =>
    u === 'min'
      ? t('settings.engine.limits.unit.min')
      : u === 'sec'
        ? t('settings.engine.limits.unit.sec')
        : u === 'mb'
          ? t('settings.engine.limits.unit.mb')
          : u === 'calls'
            ? t('settings.engine.limits.unit.calls')
            : t('settings.engine.limits.unit.cells')

  const commit = (key: EngineLimitKey, value: number | undefined): void => {
    const next: EngineLimits = { ...current }
    if (value === undefined) delete next[key]
    else next[key] = value
    void update({ engineLimits: next })
  }

  const codeFields: FieldDef[] = [
    {
      key: 'codeTimeoutMin',
      label: t('settings.engine.limits.codeTimeoutMin.label'),
      desc: t('settings.engine.limits.codeTimeoutMin.desc'),
      unitLabel: unit('min')
    },
    {
      key: 'codeMaxCalls',
      label: t('settings.engine.limits.codeMaxCalls.label'),
      desc: t('settings.engine.limits.codeMaxCalls.desc'),
      unitLabel: unit('calls')
    },
    {
      key: 'codeOutputMb',
      label: t('settings.engine.limits.codeOutputMb.label'),
      desc: t('settings.engine.limits.codeOutputMb.desc'),
      unitLabel: unit('mb')
    },
    {
      key: 'codeYieldSec',
      label: t('settings.engine.limits.codeYieldSec.label'),
      desc: t('settings.engine.limits.codeYieldSec.desc'),
      unitLabel: unit('sec')
    },
    {
      key: 'codeMaxCells',
      label: t('settings.engine.limits.codeMaxCells.label'),
      desc: t('settings.engine.limits.codeMaxCells.desc'),
      unitLabel: unit('cells')
    }
  ]
  const shellFields: FieldDef[] = [
    {
      key: 'shellLifeMin',
      label: t('settings.engine.limits.shellLifeMin.label'),
      desc: t('settings.engine.limits.shellLifeMin.desc'),
      unitLabel: unit('min')
    },
    {
      key: 'shellOutputMb',
      label: t('settings.engine.limits.shellOutputMb.label'),
      desc: t('settings.engine.limits.shellOutputMb.desc'),
      unitLabel: unit('mb')
    }
  ]

  return (
    <section aria-labelledby={`${id}-t`} aria-describedby={`${id}-d`} className="mb-8">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <h3 id={`${id}-t`} className="text-sm font-semibold">
          {t('settings.engine.limits.title')}
        </h3>
        <Button size="sm" variant="secondary" disabled={!changed} onClick={() => void update({ engineLimits: {} })}>
          {t('settings.engine.limits.reset')}
        </Button>
      </div>
      <p id={`${id}-d`} className="mb-3 text-sm leading-relaxed text-muted">
        {t('settings.engine.limits.desc')}
      </p>
      <h4 className="mb-1 text-xs font-semibold text-muted">{t('settings.engine.limits.codeGroup')}</h4>
      <Card className="mb-4">
        <div role="group" aria-label={t('settings.engine.limits.codeGroup')}>
          {codeFields.map((f) => (
            <LimitField key={f.key} def={f} stored={current[f.key]} commit={commit} />
          ))}
        </div>
      </Card>
      <h4 className="mb-1 text-xs font-semibold text-muted">{t('settings.engine.limits.shellGroup')}</h4>
      <Card className="mb-2">
        <div role="group" aria-label={t('settings.engine.limits.shellGroup')}>
          {shellFields.map((f) => (
            <LimitField key={f.key} def={f} stored={current[f.key]} commit={commit} />
          ))}
        </div>
      </Card>
      <p className="text-xs leading-relaxed text-muted">{t('settings.engine.limits.note')}</p>
    </section>
  )
}
