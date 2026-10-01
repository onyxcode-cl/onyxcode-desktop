/**
 * Pantalla de acceso (cuenta obligatoria cuando `ACCOUNT_API` está definido). Estados:
 * comprobando sesión, elegir cómo entrar (Google o correo + código), esperando al navegador,
 * sin red/servidor caído, sesión caducada/revocada y cuenta borrada. Sin contraseñas: el correo
 * recibe un código de 6 dígitos. Todo el tráfico va por main (el renderer no sale a internet).
 */
import { useRef, useState, type KeyboardEvent } from 'react'
import { AlertTriangle, ArrowLeft, Loader2, Mail, WifiOff } from 'lucide-react'
import { cleanCodeInput, CODE_LENGTH, EMAIL_MAX, isValidCode, isValidEmail, normalizeEmail, type AccountState } from '@shared/account'
import { PRIVACY_DRAFT, TERMS_DRAFT, type LegalDoc } from '@shared/account-legal'
import type { MsgKey } from '@shared/i18n'
import { APP_NAME, PRIVACY_URL, TERMS_URL } from '@shared/brand'
import { Button } from '../../components/Button'
import { Logo } from '../../components/Logo'
import { useT } from '../../lib/i18n'
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
/** Pestaña de la pantalla de acceso. Solo cambia los textos: el flujo (Google o correo + código) es el mismo. */
export type AccessMode = 'login' | 'signup'

const MODES: { id: AccessMode; label: MsgKey }[] = [
  { id: 'login', label: 'account.tab.login' },
  { id: 'signup', label: 'account.tab.signup' }
]

function ModeTabs({ mode, onChange }: { mode: AccessMode; onChange: (m: AccessMode) => void }): React.JSX.Element {
  const t = useT()
  const onKey = (e: KeyboardEvent<HTMLButtonElement>): void => {
    const i = MODES.findIndex((m) => m.id === mode)
    let next = i
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (i + 1) % MODES.length
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = (i + MODES.length - 1) % MODES.length
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = MODES.length - 1
    else return
    e.preventDefault()
    onChange(MODES[next].id)
    document.getElementById(`account-tab-${MODES[next].id}`)?.focus()
  }
  return (
    <div
      role="tablist"
      aria-label={t('account.tab.aria')}
      className="mb-5 grid grid-cols-2 gap-1 rounded-lg border border-border bg-bg p-1"
    >
      {MODES.map((m) => {
        const on = m.id === mode
        return (
          <button
            key={m.id}
            id={`account-tab-${m.id}`}
            type="button"
            role="tab"
            aria-selected={on}
            aria-controls="account-tabpanel"
            tabIndex={on ? 0 : -1}
            data-testid={`account-tab-${m.id}`}
            onClick={() => onChange(m.id)}
            onKeyDown={onKey}
            className={`rounded-md px-3 py-1.5 text-[13px] font-medium outline-none transition-colors focus-visible:shadow-[0_0_0_3px_var(--accent-ring)] ${
              on ? 'border border-border-strong bg-elevated text-fg shadow-sm' : 'border border-transparent text-muted hover:text-fg'
            }`}
          >
            {t(m.label)}
          </button>
        )
      })}
    </div>
  )
}

export interface AccessScreenProps {
  state: AccountState
  actions: AccessActions
  /** Ya usaba la app antes de las cuentas: se muestra la nota una vez. */
  showExistingNote?: boolean
  /** Solo para pruebas y capturas. */
  initial?: { step?: Step; mode?: AccessMode; accepted?: boolean; email?: string; error?: string }
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
      {sub && <p className="mt-1.5 text-sm leading-relaxed text-muted [text-wrap:pretty]">{sub}</p>}
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
  const t = useT()
  const view = accessView(state)
  const banner = accessBanner(state)
  const [step, setStep] = useState<Step>(initial?.step ?? 'choose')
  const [mode, setMode] = useState<AccessMode>(initial?.mode ?? 'login')
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
        <Title>{t('account.checking.title')}</Title>
        <p className="flex items-center gap-2 text-sm text-muted" role="status">
          <Loader2 size={15} className="animate-spin" /> {t('account.checking.wait')}
        </p>
      </Shell>
    )
  }

  if (view === 'waiting') {
    return (
      <Shell>
        <Title sub={t('account.waiting.sub')}>{t('account.waiting.title')}</Title>
        <p className="mb-5 flex items-center gap-2 text-sm text-muted" role="status">
          <Loader2 size={15} className="animate-spin" /> {t('account.waiting.status')}
        </p>
        <Button variant="secondary" data-testid="account-cancel" onClick={() => void actions.cancel()}>
          {t('account.waiting.cancel')}
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
        <Title sub={t('account.offline.sub')}>{t('account.offline.title')}</Title>
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
            onClick={() => void run(actions.retry, t('account.err.retry'))}
          >
            {busy ? <Loader2 size={14} className="animate-spin" /> : null} {t('account.offline.retry')}
          </Button>
          <Button variant="ghost" disabled={busy} onClick={() => void run(actions.signOut, t('account.err.signOut'))}>
            {t('account.offline.otherAccount')}
          </Button>
        </div>
        {state.email && <p className="mt-4 text-xs text-subtle">{t('account.offline.session', { email: state.email })}</p>}
      </Shell>
    )
  }

  // --- choose / email / code ---
  const canStart = accepted && !busy
  const login = mode === 'login'
  const emailOk = isValidEmail(email)

  const sendCode = async (): Promise<void> => {
    if (!emailOk || !accepted) return
    const ok = await run(() => actions.emailStart(normalizeEmail(email)), t('account.err.sendCode'))
    if (ok) {
      setCode('')
      setStep('code')
      setTimeout(() => codeRef.current?.focus(), 0)
    }
  }

  const verify = async (value: string): Promise<void> => {
    if (!isValidCode(value) || busy) return
    const ok = await run(() => actions.emailVerify(normalizeEmail(email), value), t('account.err.verifyCode'))
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
        {t('account.terms.accept')}{' '}
        <button
          type="button"
          className="text-accent underline underline-offset-2 hover:opacity-80"
          onClick={(e) => {
            e.preventDefault()
            openLegal(termsUrl, TERMS_DRAFT)
          }}
        >
          {t('account.terms.terms')}
        </button>{' '}
        {t('account.terms.and')}{' '}
        <button
          type="button"
          className="text-accent underline underline-offset-2 hover:opacity-80"
          onClick={(e) => {
            e.preventDefault()
            openLegal(privacyUrl, PRIVACY_DRAFT)
          }}
        >
          {t('account.terms.privacy')}
        </button>
      </span>
    </label>
  )

  return (
    <>
      {/* Fuera de la tarjeta: su animación crearía un bloque contenedor y el diálogo quedaría recortado. */}
      {legal && <LegalDialog doc={legal} onClose={() => setLegal(null)} />}
      <Shell>
        {step === 'choose' && (
          <>
            <ModeTabs mode={mode} onChange={setMode} />
            <div role="tabpanel" id="account-tabpanel" aria-labelledby={`account-tab-${mode}`}>
              <Title sub={login ? t('account.choose.login.sub') : t('account.choose.signup.sub')}>
                {login ? t('account.choose.login.title', { app: APP_NAME }) : t('account.choose.signup.title', { app: APP_NAME })}
              </Title>

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
                  {t('account.choose.existingNote', { app: APP_NAME, note: t('account.existingUserNote') })}
                </p>
              )}

              {error && (
                <div className="mb-4">
                  <ErrorBox>{error}</ErrorBox>
                </div>
              )}

              <div className="mb-4 space-y-1.5">
                {terms}
                {!accepted && <p className="pl-[26px] text-xs text-subtle">{t('account.choose.checkTerms')}</p>}
              </div>

              <div className="space-y-2.5">
                <Button
                  variant="secondary"
                  className="w-full !py-2.5"
                  disabled={!canStart}
                  data-testid="account-google"
                  onClick={() => void run(actions.google, t('account.err.google'))}
                >
                  <span aria-hidden className="flex h-5 w-5 items-center justify-center rounded-full bg-hover text-[11px] font-bold">
                    G
                  </span>
                  {login ? t('account.choose.googleLogin') : t('account.choose.googleSignup')}
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
                  <Mail size={15} /> {login ? t('account.choose.emailLogin') : t('account.choose.emailSignup')}
                </Button>
              </div>

              <div className="mt-5 space-y-3">
                <p className="text-xs leading-relaxed text-subtle [text-wrap:pretty]">{t('account.dataSentence')}</p>
                {state.memoryOnly && (
                  <p className="text-xs leading-relaxed text-warning" data-testid="account-memory-only">
                    {t('account.choose.memoryOnly')}
                  </p>
                )}
              </div>
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
            <Title sub={t('account.email.sub')}>{login ? t('account.email.titleLogin') : t('account.email.titleSignup')}</Title>
            {error && (
              <div className="mb-4">
                <ErrorBox>{error}</ErrorBox>
              </div>
            )}
            <label className="mb-1.5 block text-[13px] font-medium" htmlFor="account-email">
              {t('account.email.label')}
            </label>
            <input
              id="account-email"
              data-testid="account-email-input"
              type="email"
              autoFocus
              autoComplete="email"
              maxLength={EMAIL_MAX}
              value={email}
              placeholder={t('account.email.placeholder')}
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
                <ArrowLeft size={14} /> {t('account.email.back')}
              </Button>
              <Button variant="primary" type="submit" disabled={!emailOk || !accepted || busy} data-testid="account-email-send">
                {busy ? <Loader2 size={14} className="animate-spin" /> : null} {t('account.email.send')}
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
                  {t('account.code.sub1', { length: CODE_LENGTH })} <span className="font-medium text-fg">{normalizeEmail(email)}</span>.{' '}
                  {t('account.code.sub2')}
                  {login && <span className="mt-1.5 block">{t('account.code.newAccountNote')}</span>}
                </>
              }
            >
              {t('account.code.title')}
            </Title>
            {error && (
              <div className="mb-4">
                <ErrorBox>{error}</ErrorBox>
              </div>
            )}
            <label className="mb-1.5 block text-[13px] font-medium" htmlFor="account-code">
              {t('account.code.label')}
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
                <ArrowLeft size={14} /> {t('account.code.changeEmail')}
              </Button>
              <Button variant="primary" type="submit" disabled={!isValidCode(code) || busy} data-testid="account-code-verify">
                {busy ? <Loader2 size={14} className="animate-spin" /> : null} {t('account.code.verify')}
              </Button>
            </div>
            <p className="mt-4 text-xs text-subtle">
              {t('account.code.didntArrive')}{' '}
              <button
                type="button"
                disabled={busy}
                className="text-accent underline underline-offset-2 hover:opacity-80 disabled:opacity-50"
                onClick={() => void run(() => actions.emailStart(normalizeEmail(email)), t('account.err.sendCode'))}
              >
                {t('account.code.resend')}
              </button>
            </p>
          </form>
        )}
      </Shell>
    </>
  )
}
