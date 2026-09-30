import { useState } from 'react'
import { Download, LogOut, Trash2 } from 'lucide-react'
import type { AccountState } from '@shared/account'
import { ACCOUNT_DATA_SENTENCE } from '@shared/account-legal'
import { Button } from '../../../components/Button'
import { confirmDialog } from '../../../components/ConfirmDialog'
import { call } from '../../../lib/api'
import { errorMessage } from '../../../lib/opencode'
import { useAccountState } from '../../../lib/use-account-state'
import { Badge, Card, ErrorText, Row, SectionHeader, SubTitle } from './ui'

const PROVIDER_LABEL = { google: 'Google', email: 'Correo con código' } as const

const DATE = new Intl.DateTimeFormat('es', { day: 'numeric', month: 'long', year: 'numeric' })

/** Estado de la sesión en palabras para la persona (puro, probado). */
export function accountStatusLabel(s: Pick<AccountState, 'status' | 'graceEndsAt'>): { tone: 'ok' | 'warn' | 'error'; text: string } {
  if (s.status === 'signed-in') return { tone: 'ok', text: 'Sesión iniciada' }
  if (s.status === 'grace') {
    const until = s.graceEndsAt ? ` hasta el ${DATE.format(new Date(s.graceEndsAt))}` : ''
    return { tone: 'warn', text: `Sin conexión con el servidor: puedes usar la app${until}` }
  }
  return { tone: 'error', text: 'Sin sesión' }
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
  const status = accountStatusLabel(state)
  return (
    <div data-testid="account-section">
      <SectionHeader title="Cuenta" description={ACCOUNT_DATA_SENTENCE} />
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
        <Row label="Correo">
          <span className="font-mono text-sm" data-testid="account-email">
            {state.email ?? '—'}
          </span>
        </Row>
        <Row label="Acceso con">
          <span className="text-sm">{state.provider ? PROVIDER_LABEL[state.provider] : '—'}</span>
        </Row>
        <Row label="Estado">
          <Badge tone={status.tone}>{status.text}</Badge>
        </Row>
        <Row label="Cerrar sesión" description="Vuelves a la pantalla de acceso. Tus conversaciones y claves de IA se quedan en tu Mac.">
          <Button variant="secondary" disabled={busy !== null} onClick={onSignOut}>
            <LogOut size={14} /> Cerrar sesión
          </Button>
        </Row>
      </Card>

      <SubTitle>Tus datos</SubTitle>
      <Card>
        <Row label="Descargar mis datos" description="Un archivo JSON con lo que el servidor guarda de tu cuenta.">
          <Button variant="secondary" disabled={busy !== null} onClick={onExport}>
            <Download size={14} /> Descargar mis datos
          </Button>
        </Row>
        <Row
          label="Borrar mi cuenta"
          description="Borra tu cuenta y tus datos del servidor. No toca las claves de IA ni las conversaciones de este Mac."
        >
          <Button variant="danger" disabled={busy !== null} onClick={onDelete}>
            <Trash2 size={14} /> Borrar mi cuenta
          </Button>
        </Row>
      </Card>
    </div>
  )
}

export function AccountSection(): React.JSX.Element {
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
          if (r.saved) setNotice('Tus datos se guardaron en el archivo que elegiste.')
        })
      }
      onDelete={() =>
        void run('delete', async () => {
          const ok = await confirmDialog({
            title: '¿Borrar tu cuenta?',
            message:
              'Se borrarán tu cuenta y tus datos del servidor. No se puede deshacer.\n\nTus conversaciones y claves de IA de este Mac no se tocan.',
            confirmLabel: 'Borrar mi cuenta',
            danger: true
          })
          if (ok) await call('account:delete')
        })
      }
    />
  )
}
