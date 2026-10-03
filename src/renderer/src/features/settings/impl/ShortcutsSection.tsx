import { useEffect, useState } from 'react'
import { Keyboard, RotateCcw, X, Zap } from 'lucide-react'
import { t as tr } from '@shared/i18n'
import { defaultQuickEntryShortcut } from '@shared/ipc-extras'
import { Button } from '../../../components/Button'
import { useT } from '../../../lib/i18n'
import { currentPlatform } from '../../../lib/platform'
import { getExtras, useExtrasPrefs } from './extras'
import { KeybindingsList } from './KeybindingsList'
import { Card, ErrorText, Row, SectionHeader, SubTitle } from './ui'

const isMac = navigator.userAgent.includes('Mac')

const MOD_SYMBOL: Record<string, string> = isMac
  ? { Command: '⌘', CommandOrControl: '⌘', Control: '⌃', Alt: '⌥', Option: '⌥', Shift: '⇧', Super: '⌘' }
  : { Command: 'Win', CommandOrControl: 'Ctrl', Control: 'Ctrl', Alt: 'Alt', Option: 'Alt', Shift: 'Shift', Super: 'Win' }

const KEY_LABEL: Record<string, () => string> = {
  Space: () => tr('settings.shortcuts.space'),
  Return: () => '↩',
  Up: () => '↑',
  Down: () => '↓',
  Left: () => '←',
  Right: () => '→',
  Backspace: () => '⌫',
  Delete: () => '⌦',
  Tab: () => '⇥'
}

/** Convierte un acelerador de Electron a teclas legibles. */
export function acceleratorParts(acc: string): string[] {
  if (!acc) return []
  return acc.split('+').map((p) => MOD_SYMBOL[p] ?? KEY_LABEL[p]?.() ?? p)
}

/** KeyboardEvent → acelerador de Electron (usa `code` para ignorar caracteres de Option). */
function toAccelerator(e: KeyboardEvent): string | null {
  const key = codeToKey(e.code)
  if (!key) return null
  const mods: string[] = []
  if (e.metaKey) mods.push(isMac ? 'Command' : 'Super')
  if (e.ctrlKey) mods.push('Control')
  if (e.altKey) mods.push('Alt')
  if (e.shiftKey) mods.push('Shift')
  const isFn = /^F\d{1,2}$/.test(key)
  if (!mods.length && !isFn) return null
  // Shift solo + tecla normal no es un atajo global razonable.
  if (mods.length === 1 && mods[0] === 'Shift' && !isFn) return null
  return [...mods, key].join('+')
}

function codeToKey(code: string): string | null {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3)
  if (/^Digit\d$/.test(code)) return code.slice(5)
  if (/^F\d{1,2}$/.test(code)) return code
  const map: Record<string, string> = {
    Space: 'Space',
    Enter: 'Return',
    Tab: 'Tab',
    Backspace: 'Backspace',
    Delete: 'Delete',
    ArrowUp: 'Up',
    ArrowDown: 'Down',
    ArrowLeft: 'Left',
    ArrowRight: 'Right',
    Minus: '-',
    Equal: '=',
    BracketLeft: '[',
    BracketRight: ']',
    Backslash: '\\',
    Semicolon: ';',
    Quote: "'",
    Comma: ',',
    Period: '.',
    Slash: '/',
    Backquote: '`',
    Home: 'Home',
    End: 'End',
    PageUp: 'PageUp',
    PageDown: 'PageDown'
  }
  return map[code] ?? null
}

export function Keys({ accelerator }: { accelerator: string }): React.JSX.Element {
  const t = useT()
  const parts = acceleratorParts(accelerator)
  if (!parts.length) return <span className="text-xs text-muted">{t('settings.shortcuts.off')}</span>
  return (
    <span className="inline-flex gap-1">
      {parts.map((p, i) => (
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

export function ShortcutsSection(): React.JSX.Element {
  const t = useT()
  const { prefs, shortcutError, update, error } = useExtrasPrefs()
  const [recording, setRecording] = useState(false)
  const [hint, setHint] = useState<string | null>(null)

  useEffect(() => {
    if (!recording) return
    const extras = getExtras()
    void extras?.invoke('extras:suspendShortcut', { suspended: true })
    const onKey = (e: KeyboardEvent): void => {
      e.preventDefault()
      e.stopPropagation()
      if (e.key === 'Escape' && !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey) {
        setRecording(false)
        setHint(null)
        return
      }
      if (['Meta', 'Control', 'Alt', 'Shift'].includes(e.key)) return
      const acc = toAccelerator(e)
      if (!acc) {
        setHint(t('settings.shortcuts.needModifier'))
        return
      }
      setRecording(false)
      setHint(null)
      void update({ quickEntryShortcut: acc })
    }
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      void extras?.invoke('extras:suspendShortcut', { suspended: false })
    }
  }, [recording, update, t])

  return (
    <div>
      <SectionHeader title={t('settings.shortcuts.title')} description={t('settings.shortcuts.subtitle')} />
      <Card>
        <Row
          label={
            <span className="flex items-center gap-2">
              <Zap size={15} /> Quick Entry
            </span>
          }
          description={t('settings.shortcuts.quick.description')}
        >
          <div className="flex items-center gap-2">
            {recording ? (
              <span className="rounded-lg border border-accent bg-accent-soft px-3 py-1 text-xs text-accent">
                {t('settings.shortcuts.recording')}
              </span>
            ) : (
              <Keys accelerator={prefs.quickEntryShortcut} />
            )}
            <Button onClick={() => setRecording((r) => !r)}>
              <Keyboard size={14} /> {recording ? t('settings.shortcuts.cancel') : t('settings.shortcuts.change')}
            </Button>
          </div>
        </Row>
        <Row label={t('settings.shortcuts.actions')}>
          <div className="flex gap-1">
            <Button variant="ghost" onClick={() => void getExtras()?.invoke('extras:quickToggle')}>
              {t('settings.shortcuts.try')}
            </Button>
            <Button
              variant="ghost"
              disabled={prefs.quickEntryShortcut === defaultQuickEntryShortcut(currentPlatform())}
              onClick={() => void update({ quickEntryShortcut: defaultQuickEntryShortcut(currentPlatform()) })}
            >
              <RotateCcw size={14} /> {t('settings.shortcuts.reset')}
            </Button>
            <Button variant="ghost" disabled={!prefs.quickEntryShortcut} onClick={() => void update({ quickEntryShortcut: '' })}>
              <X size={14} /> {t('settings.shortcuts.disable')}
            </Button>
          </div>
        </Row>
      </Card>
      {hint && <p className="mt-2 text-xs text-muted">{hint}</p>}
      {(shortcutError || error) && (
        <div className="mt-3">
          <ErrorText>{shortcutError ?? error}</ErrorText>
        </div>
      )}

      <KeybindingsList />

      <SubTitle>{t('settings.shortcuts.inQuick')}</SubTitle>
      <Card>
        <Row label={t('settings.shortcuts.sendToChat')}>
          <Keys accelerator="Return" />
        </Row>
        <Row label={t('settings.shortcuts.clearClose')}>
          <kbd className="rounded-md border border-border-strong bg-bg px-1.5 py-0.5 text-xs">Esc</kbd>
        </Row>
      </Card>
    </div>
  )
}
