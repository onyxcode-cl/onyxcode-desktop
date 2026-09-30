/**
 * Pantalla de acceso (cuenta obligatoria cuando `ACCOUNT_API` está definido). Estados:
 * comprobando sesión, elegir cómo entrar (Google o correo + código), esperando al navegador,
 * sin red/servidor caído, sesión caducada/revocada y cuenta borrada. Sin contraseñas: el correo
 * recibe un código de 6 dígitos. Todo el tráfico va por main (el renderer no sale a internet).
 */
import { useRef, useState } from 'react'
import { AlertTriangle, ArrowLeft, Loader2, Mail, WifiOff } from 'lucide-react'
import { cleanCodeInput, CODE_LENGTH, EMAIL_MAX, isValidCode, isValidEmail, normalizeEmail, type AccountState } from '@shared/account'
import { ACCOUNT_DATA_SENTENCE, EXISTING_USER_NOTE, PRIVACY_DRAFT, TERMS_DRAFT, type LegalDoc } from '@shared/account-legal'
import { APP_NAME, PRIVACY_URL, TERMS_URL } from '@shared/brand'
import { Button } from '../../components/Button'
import { Logo } from '../../components/Logo'
import { accessBanner, accessView } from './access-view'
import { LegalDialog } from './LegalDialog'

export interface AccessActions {
  google(): Promise<void>
  cancel(): Promise<void>
  emailStart(email: string): Promise<void>
  emailVerify(email: string, code: string): Promise<void>
  retry(): Promise<void>
  signOut(): Promise<void>
  openUrl(url: string): Promise<void>
}

type Step = 'choose' | 'email' | 'code'

export interface AccessScreenProps {
  state: AccountState
  actions: AccessActions
  /** Ya usaba la app antes de las cuentas: se muestra la nota una vez. */
  showExistingNote?: boolean
  /** Solo para pruebas y capturas. */
  initial?: { step?: Step; accepted?: boolean; email?: string; error?: string }
  /** Mensaje del último intento de entrar (pruebas). */
  privacyUrl?: string
  termsUrl?: string
}

function message(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback
}

function ErrorBox({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <div
      role="alert"
      data-testid="account-error"
      className="rounded-lg border border-danger/30 bg-danger/5 px-3 py-2 text-[13px] text-danger"
    >
      {children}
    </div>
  )
}

function Shell({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <div data-testid="account-gate" className="fixed inset-0 z-[100] flex flex-col bg-bg">
      <div className="drag h-12 shrink-0" />
      <div className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto p-6">
        <section
          aria-labelledby="account-title"
          className="w-full max-w-[26rem] animate-rise-in rounded-2xl border border-border bg-elevated p-8 shadow-xl"
        >
          <Logo size={30} className="mb-7" />
          {children}
        </section>
      </div>
    </div>
  )
}

function Title({ children, sub }: { children: React.ReactNode; sub?: React.ReactNode }): React.JSX.Element {
  return (
    <div className="mb-5">
      <h1 id="account-title" className="font-display text-[22px] font-semibold tracking-[-0.015em]">
        {children}
      </h1>
      {sub && <p className="mt-1.5 text-sm leading-relaxed text-muted">{sub}</p>}
    </div>
  )
}

export function AccessScreen({
  state,
  actions,
  showExistingNote,
  initial,
  privacyUrl = PRIVACY_URL,
  termsUrl = TERMS_URL
}: AccessScreenProps): React.JSX.Element {
  const view = accessView(state)
  const banner = accessBanner(state)
  const [step, setStep] = useState<Step>(initial?.step ?? 'choose')
  const [accepted, setAccepted] = useState(initial?.accepted ?? false)
  const [email, setEmail] = useState(initial?.email ?? '')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(initial?.error ?? null)
  const [legal, setLegal] = useState<LegalDoc | null>(null)
  const codeRef = useRef<HTMLInputElement>(null)

  const run = async (fn: () => Promise<void>, fallback: string): Promise<boolean> => {
    setBusy(true)
    setError(null)
    try {
      await fn()
      return true
    } catch (err) {
      setError(message(err, fallback))
      return false
    } finally {
      setBusy(false)
    }
  }

  const openLegal = (url: string, doc: LegalDoc): void => {
    if (url) void actions.openUrl(url).catch(() => undefined)
    else setLegal(doc)
  }

  if (view === 'checking') {
    return (
      <Shell>
        <Title>Comprobando tu sesión…</Title>
        <p className="flex items-center gap-2 text-sm text-muted" role="status">
          <Loader2 size={15} className="animate-spin" /> Un momento.
        </p>
      </Shell>
    )
  }

  if (view === 'waiting') {
    return (
      <Shell>
        <Title sub="Termina de iniciar sesión con Google en el navegador. Cuando acabes, vuelve aquí: la app seguirá sola.">
          Esperando al navegador…
        </Title>
        <p className="mb-5 flex items-center gap-2 text-sm text-muted" role="status">
          <Loader2 size={15} className="animate-spin" /> Esperando la confirmación (hasta 5 minutos).
        </p>
        <Button variant="secondary" data-testid="account-cancel" onClick={() => void actions.cancel()}>
          Cancelar
        </Button>
      </Shell>
    )
  }

  if (view === 'offline') {
    return (
      <Shell>
        <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-xl bg-warning/10 text-warning">
          <WifiOff size={20} />
        </div>
        <Title sub="No pudimos comprobar tu sesión con el servidor y pasaron más de 30 días desde la última vez. Conéctate a internet y vuelve a intentarlo.">
          Sin conexión con el servidor
        </Title>
        {error && (
          <div className="mb-4">
            <ErrorBox>{error}</ErrorBox>
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          <Button
            variant="primary"
            disabled={busy}
            data-testid="account-retry"
            onClick={() => void run(actions.retry, 'No se pudo reintentar.')}
          >
            {busy ? <Loader2 size={14} className="animate-spin" /> : null} Reintentar
          </Button>
          <Button variant="ghost" disabled={busy} onClick={() => void run(actions.signOut, 'No se pudo cerrar la sesión.')}>
            Usar otra cuenta
          </Button>
        </div>
        {state.email && <p className="mt-4 text-xs text-subtle">Sesión de {state.email}</p>}
      </Shell>
    )
  }

  // --- choose / email / code ---
  const canStart = accepted && !busy
  const emailOk = isValidEmail(email)

  const sendCode = async (): Promise<void> => {
    if (!emailOk || !accepted) return
    const ok = await run(() => actions.emailStart(normalizeEmail(email)), 'No se pudo enviar el código.')
    if (ok) {
      setCode('')
      setStep('code')
      setTimeout(() => codeRef.current?.focus(), 0)
    }
  }

  const verify = async (value: string): Promise<void> => {
    if (!isValidCode(value) || busy) return
    const ok = await run(() => actions.emailVerify(normalizeEmail(email), value), 'No se pudo verificar el código.')
    if (!ok) setCode('')
  }

  const terms = (
    <label className="flex cursor-pointer items-start gap-2.5 text-[13px] leading-snug text-muted">
      <input
        type="checkbox"
        data-testid="account-terms"
        checked={accepted}
        onChange={(e) => setAccepted(e.target.checked)}
        className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--accent)]"
      />
      <span>
        Acepto los{' '}
        <button
          type="button"
          className="text-accent underline underline-offset-2 hover:opacity-80"
          onClick={(e) => {
            e.preventDefault()
            openLegal(termsUrl, TERMS_DRAFT)
          }}
        >
          términos
        </button>{' '}
        y la{' '}
        <button
          type="button"
          className="text-accent underline underline-offset-2 hover:opacity-80"
          onClick={(e) => {
            e.preventDefault()
            openLegal(privacyUrl, PRIVACY_DRAFT)
          }}
        >
          política de privacidad
        </button>
      </span>
    </label>
  )

  return (
    <Shell>
      {legal && <LegalDialog doc={legal} onClose={() => setLegal(null)} />}

      {step === 'choose' && (
        <>
          <Title sub="Entra con tu cuenta de Google o crea una con tu correo. No hay contraseñas.">Entra a {APP_NAME}</Title>

          {banner && (
            <div role="status" className="mb-4 flex gap-2.5 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2.5 text-[13px]">
              <AlertTriangle size={15} className="mt-0.5 shrink-0 text-warning" />
              <div>
                <p className="font-medium">{banner.title}</p>
                <p className="text-muted">{banner.body}</p>
              </div>
            </div>
          )}

          {showExistingNote && (
            <p
              className="mb-4 rounded-lg border border-accent/30 bg-accent-soft px-3 py-2.5 text-[13px] leading-snug"
              data-testid="account-existing-note"
            >
              Ya usabas {APP_NAME}: ahora pedimos una cuenta. {EXISTING_USER_NOTE}
            </p>
          )}

          {error && (
            <div className="mb-4">
              <ErrorBox>{error}</ErrorBox>
            </div>
          )}

          <div className="space-y-2.5">
            <Button
              variant="secondary"
              className="w-full !py-2.5"
              disabled={!canStart}
              data-testid="account-google"
              onClick={() => void run(actions.google, 'No se pudo iniciar sesión con Google.')}
            >
              <span aria-hidden className="flex h-5 w-5 items-center justify-center rounded-full bg-hover text-[11px] font-bold">
                G
              </span>
              Continuar con Google
            </Button>
            <Button
              variant="primary"
              className="w-full !py-2.5"
              disabled={!canStart}
              data-testid="account-email-open"
              onClick={() => {
                setError(null)
                setStep('email')
              }}
            >
              <Mail size={15} /> Crear una cuenta con tu correo
            </Button>
          </div>

          <div className="mt-5 space-y-3">
            {terms}
            {!accepted && <p className="text-xs text-subtle">Marca la casilla para continuar.</p>}
            <p className="text-xs leading-relaxed text-subtle">{ACCOUNT_DATA_SENTENCE}</p>
            {state.memoryOnly && (
              <p className="text-xs leading-relaxed text-warning" data-testid="account-memory-only">
                No se pudo usar el Llavero de macOS en este equipo: tu sesión durará solo hasta que cierres la app.
              </p>
            )}
          </div>
        </>
      )}

      {step === 'email' && (
        <form
          onSubmit={(e) => {
            e.preventDefault()
            void sendCode()
          }}
        >
          <Title sub="Te enviaremos un código de 6 dígitos para confirmar que el correo es tuyo.">Crear una cuenta</Title>
          {error && (
            <div className="mb-4">
              <ErrorBox>{error}</ErrorBox>
            </div>
          )}
          <label className="mb-1.5 block text-[13px] font-medium" htmlFor="account-email">
            Correo electrónico
          </label>
          <input
            id="account-email"
            data-testid="account-email-input"
            type="email"
            autoFocus
            autoComplete="email"
            maxLength={EMAIL_MAX}
            value={email}
            placeholder="tu@correo.com"
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-fg outline-none transition-[border-color,box-shadow] placeholder:text-subtle hover:border-border-strong focus:border-accent focus:shadow-[0_0_0_3px_var(--accent-ring)]"
          />
          <div className="mt-5 flex items-center justify-between gap-2">
            <Button
              variant="ghost"
              onClick={() => {
                setError(null)
                setStep('choose')
              }}
            >
              <ArrowLeft size={14} /> Volver
            </Button>
            <Button variant="primary" type="submit" disabled={!emailOk || !accepted || busy} data-testid="account-email-send">
              {busy ? <Loader2 size={14} className="animate-spin" /> : null} Enviar código
            </Button>
          </div>
        </form>
      )}

      {step === 'code' && (
        <form
          onSubmit={(e) => {
            e.preventDefault()
            void verify(code)
          }}
        >
          <Title
            sub={
              <>
                Escribe el código de {CODE_LENGTH} dígitos que enviamos a{' '}
                <span className="font-medium text-fg">{normalizeEmail(email)}</span>. Vence en 10 minutos.
              </>
            }
          >
            Revisa tu correo
          </Title>
          {error && (
            <div className="mb-4">
              <ErrorBox>{error}</ErrorBox>
            </div>
          )}
          <label className="mb-1.5 block text-[13px] font-medium" htmlFor="account-code">
            Código
          </label>
          <input
            id="account-code"
            ref={codeRef}
            data-testid="account-code-input"
            inputMode="numeric"
            autoComplete="one-time-code"
            autoFocus
            maxLength={CODE_LENGTH}
            value={code}
            placeholder="000000"
            onChange={(e) => {
              const v = cleanCodeInput(e.target.value)
              setCode(v)
              if (v.length === CODE_LENGTH) void verify(v)
            }}
            className="w-full rounded-lg border border-border bg-bg px-3 py-2.5 text-center font-mono text-xl tracking-[0.5em] text-fg outline-none transition-[border-color,box-shadow] placeholder:text-subtle hover:border-border-strong focus:border-accent focus:shadow-[0_0_0_3px_var(--accent-ring)]"
          />
          <div className="mt-5 flex items-center justify-between gap-2">
            <Button
              variant="ghost"
              onClick={() => {
                setError(null)
                setStep('email')
              }}
            >
              <ArrowLeft size={14} /> Cambiar correo
            </Button>
            <Button variant="primary" type="submit" disabled={!isValidCode(code) || busy} data-testid="account-code-verify">
              {busy ? <Loader2 size={14} className="animate-spin" /> : null} Entrar
            </Button>
          </div>
          <p className="mt-4 text-xs text-subtle">
            ¿No llegó?{' '}
            <button
              type="button"
              disabled={busy}
              className="text-accent underline underline-offset-2 hover:opacity-80 disabled:opacity-50"
              onClick={() => void run(() => actions.emailStart(normalizeEmail(email)), 'No se pudo enviar el código.')}
            >
              Enviar otro código
            </button>
          </p>
        </form>
      )}
    </Shell>
  )
}
