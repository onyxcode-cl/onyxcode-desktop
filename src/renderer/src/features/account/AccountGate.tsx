import { useEffect } from 'react'
import { isAccessOpen } from '@shared/account'
import { Button } from '../../components/Button'
import { call } from '../../lib/api'
import { useT } from '../../lib/i18n'
import { useAccountState } from '../../lib/use-account-state'
import { useSettings } from '../../stores/settings'
import { useTheme } from '../../app/useTheme'
import { AccessScreen, type AccessActions } from './AccessScreen'
import { markNoteSeen, noteSeen, shouldShowExistingUserNote } from './access-view'

const actions: AccessActions = {
  google: async () => void (await call('account:google')),
  cancel: async () => void (await call('account:cancel')),
  emailStart: (email) => call('account:emailStart', { email }),
  emailVerify: async (email, code) => void (await call('account:emailVerify', { email, code })),
  retry: async () => void (await call('account:retry')),
  signOut: async () => void (await call('account:signOut')),
  openUrl: (url) => call('app:openExternal', { url })
}

/** Carga los ajustes (tema, «ya usabas la app») solo mientras se ve la pantalla de acceso. */
function AccessHost({ state }: { state: NonNullable<ReturnType<typeof useAccountState>[0]> }): React.JSX.Element {
  const loaded = useSettings((s) => s.loaded)
  const onboarded = useSettings((s) => s.settings.onboarded)
  useTheme()
  useEffect(() => useSettings.getState().init(), [])
  return (
    <AccessScreen
      state={state}
      actions={actions}
      showExistingNote={loaded && shouldShowExistingUserNote({ onboarded, seen: noteSeen() })}
    />
  )
}

/**
 * Puerta de la cuenta. `<AccountGate><App/></AccountGate>`: mientras no se pasa, NO se monta la app
 * (ni sus efectos ni el asistente «Conecta tu IA»). Con la cuenta apagada deja pasar sin mostrar nada.
 */
export function AccountGate({ children }: { children: React.ReactNode }): React.JSX.Element | null {
  const t = useT()
  const [state, , failed, reload] = useAccountState()
  // La nota «ya tenías la app» se da por vista cuando la persona entra.
  const open = state !== null && state.required && isAccessOpen(state)
  useEffect(() => {
    if (open) markNoteSeen()
  }, [open])
  if (failed && !state) {
    return (
      <div className="fixed inset-0 flex flex-col items-center justify-center gap-3 bg-bg p-6 text-sm text-muted" role="alert">
        <p>{t('account.gate.readFailed')}</p>
        <Button variant="secondary" onClick={reload}>
          {t('account.gate.retry')}
        </Button>
      </div>
    )
  }
  if (!state) return null
  if (isAccessOpen(state)) return <>{children}</>
  return <AccessHost state={state} />
}
