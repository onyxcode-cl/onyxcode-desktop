/**
 * Ajustes › Atajos › «En la aplicación» (F8-B46): lista agrupada y con buscador de las acciones con atajo configurable.
 * Grabar («pulsa las teclas»), detectar conflictos y combinaciones reservadas del sistema, restablecer uno o todos y
 * desactivar. Se guarda en `extras.json › keybindings` (`{ [idAcción]: atajo | null }`).
 */
import { useEffect, useMemo, useState } from 'react'
import { Keyboard, RotateCcw, Search, X } from 'lucide-react'
import { t as tr } from '@shared/i18n'
import {
  ACTIONS,
  ACTIONS_BY_ID,
  KB_CATEGORIES,
  effectiveBindings,
  eventToBinding,
  isCustomized,
  validateBinding,
  withBinding,
  withDisabled,
  withReset,
  type ActionMeta,
  type KeybindingOverrides
} from '@shared/keybindings'
import { Button } from '../../../components/Button'
import { useT } from '../../../lib/i18n'
import { platformCaps } from '../../../lib/platform'
import { displayParts, kbPlatform } from '../../../keybindings/bindings'
import { suspendKeybindings } from '../../../keybindings/dispatch'
import { getExtras, useExtrasPrefs } from './extras'
import { Card } from './ui'

const norm = (s: string): string => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')

const MODIFIER_KEYS = new Set(['Control', 'Meta', 'Alt', 'AltGraph', 'Shift', 'OS', 'CapsLock', 'Fn'])

function BindingKeys({ binding }: { binding: string | null }): React.JSX.Element {
  const t = useT()
  if (!binding) return <span className="text-xs text-muted">{t('settings.shortcuts.off')}</span>
  return (
    <span className="inline-flex gap-1" data-binding={binding}>
      {displayParts(binding).map((p, i) => (
        <kbd
          key={i}
          className="min-w-6 rounded-md border border-border-strong bg-bg px-1.5 py-0.5 text-center font-sans text-xs shadow-[0_1px_0_var(--border-strong)]"
        >
          {p}
        </kbd>
      ))}
    </span>
  )
}

function keysText(binding: string): string {
  return displayParts(binding).join(kbPlatform() === 'mac' ? '' : '+')
}

interface Pending {
  actionId: string
  binding: string
  conflicts: ActionMeta[]
}

export function KeybindingsList(): React.JSX.Element {
  const t = useT()
  const overrides = useExtrasPrefs((s) => s.prefs.keybindings)
  const quick = useExtrasPrefs((s) => s.prefs.quickEntryShortcut)
  const update = useExtrasPrefs((s) => s.update)
  const platform = kbPlatform()
  const effective = useMemo(() => effectiveBindings(overrides, platform), [overrides, platform])
  const [query, setQuery] = useState('')
  const [recording, setRecording] = useState<string | null>(null)
  const [hint, setHint] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [pending, setPending] = useState<Pending | null>(null)

  const save = (next: KeybindingOverrides): void => void update({ keybindings: next })
  const name = (a: ActionMeta): string => t(a.nameKey)

  useEffect(() => {
    if (!recording) return
    const actionId = recording
    const release = suspendKeybindings()
    const extras = getExtras()
    void extras?.invoke('extras:suspendShortcut', { suspended: true })
    const onKey = (e: KeyboardEvent): void => {
      if (MODIFIER_KEYS.has(e.key)) return
      e.preventDefault()
      e.stopPropagation()
      if (e.key === 'Escape' && !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey) {
        setRecording(null)
        setHint(null)
        return
      }
      const candidate = eventToBinding(e, platform)
      if (!candidate) {
        setHint(t('settings.shortcuts.invalid'))
        return
      }
      const res = validateBinding(candidate, actionId, effective, platform, quick)
      if (!res.ok) {
        if (res.error === 'needsModifier') setHint(t('settings.shortcuts.needModifier'))
        else if (res.error === 'blocked') {
          setHint(
            t(res.reserved?.reason === 'edit' ? 'settings.shortcuts.blocked.edit' : 'settings.shortcuts.blocked.system', {
              keys: keysText(candidate)
            })
          )
        } else setHint(t('settings.shortcuts.invalid'))
        return
      }
      setRecording(null)
      setHint(null)
      if (res.conflicts.length > 0) {
        setPending({ actionId, binding: res.binding, conflicts: res.conflicts })
        return
      }
      setNote(
        res.reserved?.level === 'warn'
          ? t('settings.shortcuts.warn.menu', { keys: keysText(res.binding) })
          : res.sameAsQuickEntry
            ? t('settings.shortcuts.warn.quick', { keys: keysText(res.binding) })
            : null
      )
      save(withBinding(overrides, actionId, res.binding, platform))
    }
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      release()
      void extras?.invoke('extras:suspendShortcut', { suspended: false })
    }
    // `save`/`t` cambian de identidad en cada render sin cambiar de efecto: el grabador solo depende de lo que lee.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recording, overrides, effective, platform, quick])

  const q = norm(query.trim())
  const groups = KB_CATEGORIES.map((c) => ({
    category: c,
    actions: ACTIONS.filter(
      (a) =>
        a.category === c &&
        (a.id !== 'remote.stopAll' || platformCaps().remote) &&
        (!q || norm(name(a)).includes(q) || norm(keysText(effective[a.id] ?? '')).includes(q))
    )
  })).filter((g) => g.actions.length > 0)

  const anyCustom = Object.keys(overrides).some((id) => ACTIONS_BY_ID[id])

  return (
    <div data-testid="keybindings-list">
      <div className="mt-9 mb-3 flex items-center justify-between gap-3">
        <h3 className="text-[11.5px] font-semibold tracking-[0.06em] text-subtle uppercase">{t('settings.shortcuts.inApp')}</h3>
        <Button
          variant="ghost"
          size="sm"
          disabled={!anyCustom}
          onClick={() => {
            setPending(null)
            setNote(null)
            save({})
          }}
        >
          <RotateCcw size={14} /> {t('settings.shortcuts.resetAll')}
        </Button>
      </div>
      <p className="mb-3 text-xs text-muted">{t('settings.shortcuts.appDescription')}</p>
      <label className="relative mb-3 block">
        <Search size={14} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-subtle" />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('settings.shortcuts.search')}
          aria-label={t('settings.shortcuts.search')}
          className="h-9 w-full rounded-lg border border-border bg-inset pr-3 pl-9 text-sm outline-none focus:border-border-strong"
        />
      </label>
      {(hint || recording) && (
        <p role="status" className="mb-3 text-xs text-muted">
          {hint ?? t('settings.shortcuts.recordingFor', { action: name(ACTIONS_BY_ID[recording!]) })}
        </p>
      )}
      {pending && (
        <div
          role="alert"
          data-testid="keybinding-conflict"
          className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-sm"
        >
          <span className="min-w-0 flex-1">
            {t('settings.shortcuts.conflict', { keys: keysText(pending.binding), other: pending.conflicts.map(name).join(', ') })}
          </span>
          <Button
            size="sm"
            onClick={() => {
              save(
                withBinding(
                  overrides,
                  pending.actionId,
                  pending.binding,
                  platform,
                  pending.conflicts.map((c) => c.id)
                )
              )
              setPending(null)
            }}
          >
            {t('settings.shortcuts.reassign')}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setPending(null)}>
            {t('settings.shortcuts.cancel')}
          </Button>
        </div>
      )}
      {note && (
        <p role="status" className="mb-3 text-xs text-warning">
          {note}
        </p>
      )}
      {groups.length === 0 && <p className="text-sm text-muted">{t('settings.shortcuts.noResults')}</p>}
      {groups.map((g, i) => (
        <div key={g.category}>
          {i > 0 && <div className="h-4" />}
          <h4 className="mb-2 text-xs font-medium text-muted">
            {tr(`settings.shortcuts.cat.${g.category}` as 'settings.shortcuts.cat.code')}
          </h4>
          <Card>
            {g.actions.map((a) => {
              const binding = effective[a.id]
              const custom = isCustomized(overrides, a.id)
              const isRec = recording === a.id
              return (
                <div
                  key={a.id}
                  className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 border-b border-border px-4 py-2.5 last:border-b-0"
                >
                  <div className="flex min-w-0 items-center gap-2 text-sm font-medium">
                    {name(a)}
                    {custom && (
                      <span className="rounded bg-accent-soft px-1.5 py-0.5 text-[10.5px] font-medium text-accent">
                        {t('settings.shortcuts.custom')}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1" data-action={a.id}>
                    {isRec ? (
                      <span className="rounded-lg border border-accent bg-accent-soft px-3 py-1 text-xs text-accent">
                        {t('settings.shortcuts.recording')}
                      </span>
                    ) : (
                      <BindingKeys binding={binding} />
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={t('settings.shortcuts.changeFor', { action: name(a) })}
                      title={t('settings.shortcuts.change')}
                      aria-pressed={isRec}
                      onClick={() => {
                        setPending(null)
                        setNote(null)
                        setHint(null)
                        setRecording(isRec ? null : a.id)
                      }}
                    >
                      <Keyboard size={14} />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={t('settings.shortcuts.resetFor', { action: name(a) })}
                      title={t('settings.shortcuts.reset')}
                      disabled={!custom}
                      onClick={() => {
                        setPending(null)
                        setNote(null)
                        save(withReset(overrides, a.id))
                      }}
                    >
                      <RotateCcw size={14} />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={t('settings.shortcuts.disableFor', { action: name(a) })}
                      title={t('settings.shortcuts.disable')}
                      disabled={!binding}
                      onClick={() => {
                        setPending(null)
                        setNote(null)
                        save(withDisabled(overrides, a.id, platform))
                      }}
                    >
                      <X size={14} />
                    </Button>
                  </div>
                </div>
              )
            })}
          </Card>
        </div>
      ))}
      <p className="mt-3 text-xs text-muted">{t('settings.shortcuts.reservedNote')}</p>
    </div>
  )
}
