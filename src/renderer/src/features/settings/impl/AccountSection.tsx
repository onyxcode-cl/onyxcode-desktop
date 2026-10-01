import { useState } from 'react'
import { Download, LogOut, Trash2 } from 'lucide-react'
import type { AccountState } from '@shared/account'
import { localeTag, t } from '@shared/i18n'
import { Button } from '../../../components/Button'
import { confirmDialog } from '../../../components/ConfirmDialog'
import { call } from '../../../lib/api'
import { useT } from '../../../lib/i18n'
import { errorMessage } from '../../../lib/opencode'
import { useAccountState } from '../../../lib/use-account-state'
import { Badge, Card, ErrorText, Row, SectionHeader, SubTitle } from './ui'

const providerLabel = (p: 'google' | 'email'): string =>
  t(p === 'google' ? 'settings.account.provider.google' : 'settings.account.provider.email')

const formatDate = (d: Date): string => new Intl.DateTimeFormat(localeTag(), { day: 'numeric', month: 'long', year: 'numeric' }).format(d)

/** Estado de la sesión en palabras para la persona (puro, probado). */
export function accountStatusLabel(s: Pick<AccountState, 'status' | 'graceEndsAt'>): { tone: 'ok' | 'warn' | 'error'; text: string } {
  if (s.status === 'signed-in') return { tone: 'ok', text: t('settings.account.status.signedIn') }
  if (s.status === 'grace') {
    const until = s.graceEndsAt ? t('settings.account.status.graceUntil', { date: formatDate(new Date(s.graceEndsAt)) }) : ''
    return { tone: 'warn', text: t('settings.account.status.grace', { until }) }
  }
  return { tone: 'error', text: t('settings.account.status.signedOut') }
}

export interface AccountSectionViewProps {
  state: AccountState
  busy: 'signOut' | 'export' | 'delete' | null
  notice: string | null
  error: string | null
  onSignOut: () => void
  onExport: () => void
  onDelete: () => void
}

/** Vista de Ajustes › Cuenta (sin lógica: testeable con `renderToStaticMarkup`). */
export function AccountSectionView({
  state,
  busy,
  notice,
  error,
  onSignOut,
  onExport,
  onDelete
}: AccountSectionViewProps): React.JSX.Element {
  const t = useT()
  const status = accountStatusLabel(state)
  return (
    <div data-testid="account-section">
      <SectionHeader title={t('settings.account.title')} description={t('account.dataSentence')} />
      {error && (
        <div className="mb-3">
          <ErrorText>{error}</ErrorText>
        </div>
      )}
      {notice && (
        <p role="status" className="mb-3 text-sm text-success">
          {notice}
        </p>
      )}
      <Card>
        <Row label={t('settings.account.email')}>
          <span className="font-mono text-sm" data-testid="account-email">
            {state.email ?? '—'}
          </span>
        </Row>
        <Row label={t('settings.account.signInWith')}>
          <span className="text-sm">{state.provider ? providerLabel(state.provider) : '—'}</span>
        </Row>
        <Row label={t('settings.account.state')}>
          <Badge tone={status.tone}>{status.text}</Badge>
        </Row>
        <Row label={t('settings.account.signOut.label')} description={t('settings.account.signOut.description')}>
          <Button variant="secondary" disabled={busy !== null} onClick={onSignOut}>
            <LogOut size={14} /> {t('settings.account.signOut.label')}
          </Button>
        </Row>
      </Card>

      <SubTitle>{t('settings.account.yourData')}</SubTitle>
      <Card>
        <Row label={t('settings.account.export.label')} description={t('settings.account.export.description')}>
          <Button variant="secondary" disabled={busy !== null} onClick={onExport}>
            <Download size={14} /> {t('settings.account.export.label')}
          </Button>
        </Row>
        <Row label={t('settings.account.delete.label')} description={t('settings.account.delete.description')}>
          <Button variant="danger" disabled={busy !== null} onClick={onDelete}>
            <Trash2 size={14} /> {t('settings.account.delete.label')}
          </Button>
        </Row>
      </Card>
    </div>
  )
}

export function AccountSection(): React.JSX.Element {
  const t = useT()
  const [state] = useAccountState()
  const [busy, setBusy] = useState<AccountSectionViewProps['busy']>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const run = async (kind: NonNullable<AccountSectionViewProps['busy']>, fn: () => Promise<void>): Promise<void> => {
    setBusy(kind)
    setError(null)
    setNotice(null)
    try {
      await fn()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(null)
    }
  }

  if (!state) return <div />

  return (
    <AccountSectionView
      state={state}
      busy={busy}
      notice={notice}
      error={error}
      onSignOut={() => void run('signOut', async () => void (await call('account:signOut')))}
      onExport={() =>
        void run('export', async () => {
          const r = await call('account:export')
          if (r.saved) setNotice(t('settings.account.exported'))
        })
      }
      onDelete={() =>
        void run('delete', async () => {
          const ok = await confirmDialog({
            title: t('settings.account.deleteConfirm.title'),
            message: t('settings.account.deleteConfirm.message'),
            confirmLabel: t('settings.account.delete.label'),
            danger: true
          })
          if (ok) await call('account:delete')
        })
      }
    />
  )
}
