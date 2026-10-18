/**
 * Ajustes › Telegram (F8-B187 y F8-B191): avisos y permisos con botones, seguir y (opcional) escribir a una conversación, con un bot que crea la propia persona.
 * La ventana nunca ve la clave del bot: la manda una vez a `main` (`telegram:saveToken`) y desde entonces solo recibe el estado
 * (¿hay bot?, últimos 4 caracteres, ¿vinculado?, código de vinculación). Diseño y límites: `docs/telegram.md`.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { ExternalLink, Loader2, ShieldAlert } from 'lucide-react'
import { BOTFATHER_URL, TELEGRAM_DEFAULT_STATE, type TelegramErrorCode, type TelegramState } from '@shared/telegram'
import type { MsgKey } from '@shared/i18n'
import { Button } from '../../../components/Button'
import { useT } from '../../../lib/i18n'
import { openExternalUrl } from '../../../lib/open-external'
import { getExtras } from './extras'
import { Badge, Card, ErrorText, NOTICE_DESK, Row, SectionHeader, SubTitle, TextInput, Toggle } from './ui'

const ERROR_KEYS: Record<TelegramErrorCode, MsgKey> = {
  'invalid-token': 'telegram.error.invalidToken',
  'bot-revoked': 'telegram.error.botRevoked',
  network: 'telegram.error.network',
  conflict: 'telegram.error.conflict',
  'no-secure-storage': 'telegram.error.noSecureStorage',
  'rate-limited': 'telegram.error.rateLimited',
  'send-failed': 'telegram.error.sendFailed',
  unknown: 'telegram.error.unknown'
}

/** `mm:ss` de una cuenta regresiva. */
function clock(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

export function TelegramSection(): React.JSX.Element {
  const t = useT()
  const [state, setState] = useState<TelegramState | null>(null)
  const [loadError, setLoadError] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [token, setToken] = useState('')
  const [tokenError, setTokenError] = useState<TelegramErrorCode | null>(null)
  const [testMsg, setTestMsg] = useState<{ ok: boolean; key: MsgKey } | null>(null)
  const [confirmRemove, setConfirmRemove] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  const busyRef = useRef(false)

  const load = useCallback(async (): Promise<void> => {
    setLoadError(false)
    try {
      const api = getExtras()
      if (!api) throw new Error('sin puente')
      setState(await api.invoke('telegram:getState'))
    } catch {
      setLoadError(true)
    }
  }, [])

  useEffect(() => {
    void load()
    const api = getExtras()
    return api?.on('telegram:state-changed', (s) => setState(s))
  }, [load])

  // La cuenta regresiva del código solo corre mientras se muestra uno.
  const showingCode = state?.code != null || state?.lockedUntil != null
  useEffect(() => {
    if (!showingCode) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [showingCode])

  const run = useCallback(async <T,>(name: string, fn: () => Promise<T>): Promise<T | null> => {
    if (busyRef.current) return null
    busyRef.current = true
    setBusy(name)
    try {
      return await fn()
    } catch {
      setLoadError(true)
      return null
    } finally {
      busyRef.current = false
      setBusy(null)
    }
  }, [])

  if (loadError && !state) {
    return (
      <div className="max-w-2xl">
        <SectionHeader title={t('telegram.title')} description={t('telegram.intro')} />
        <ErrorText>{t('telegram.loadError')}</ErrorText>
        <Button className="mt-3" onClick={() => void load()}>
          {t('telegram.retry')}
        </Button>
      </div>
    )
  }
  if (!state) {
    return (
      <div className="max-w-2xl">
        <SectionHeader title={t('telegram.title')} description={t('telegram.intro')} />
        <div role="status" className="flex items-center gap-2 text-sm text-muted">
          <Loader2 size={14} className="animate-spin" aria-hidden />
          {t('telegram.loading')}
        </div>
      </div>
    )
  }

  const s = state ?? TELEGRAM_DEFAULT_STATE
  const api = getExtras()
  const act = (
    name: string,
    ch: 'telegram:unlink' | 'telegram:removeBot' | 'telegram:panic' | 'telegram:startLinking' | 'telegram:releaseSession'
  ): Promise<unknown> =>
    run(name, async () => {
      if (api) {
        setTestMsg(null)
        setState(await api.invoke(ch))
      }
      return null
    })

  const setFlag = (name: string, ch: 'telegram:setAllowWrite' | 'telegram:setSummariesOnly', enabled: boolean): void =>
    void run(name, async () => {
      if (api) setState(await api.invoke(ch, { enabled }))
    })
  const sessionKind = s.activeSession
    ? s.activeSession.kind === 'chat'
      ? t('telegram.session.kind.chat')
      : t('telegram.session.kind.code', { folder: s.activeSession.folder ?? '' })
    : ''

  const ownerName = s.ownerLabel || t('telegram.status.linkedYou')
  const statusText =
    s.phase === 'off'
      ? t('telegram.status.off')
      : s.phase === 'no-bot'
        ? t('telegram.status.noBot')
        : s.phase === 'idle'
          ? t('telegram.status.idle')
          : s.phase === 'linking'
            ? t('telegram.status.linking')
            : t('telegram.status.linked', { name: ownerName })
  const statusTone = s.error ? 'error' : s.phase === 'linked' ? 'ok' : s.phase === 'linking' ? 'accent' : 'muted'
  const remaining = s.codeExpiresAt != null ? s.codeExpiresAt - now : 0
  const lockLeft = s.lockedUntil != null ? s.lockedUntil - now : 0
  const locked = s.lockedUntil != null && lockLeft > 0

  const saveToken = async (): Promise<void> => {
    if (!api || !token.trim()) return
    setTokenError(null)
    const res = await run('token', () => api.invoke('telegram:saveToken', { token }))
    // La clave se manda una sola vez y NO se queda en pantalla ni en memoria, la acepten o la rechacen (antes un rechazo dejaba los
    // puntos en el campo): para reintentar se escribe de nuevo.
    setToken('')
    if (!res) return
    if (!res.ok) setTokenError(res.error)
    await load()
  }

  const sendTest = async (): Promise<void> => {
    if (!api) return
    const res = await run('test', () => api.invoke('telegram:sendTest'))
    if (!res) return
    if (res.ok) setTestMsg({ ok: true, key: 'telegram.test.ok' })
    else if (res.error === 'not-linked') setTestMsg({ ok: false, key: 'telegram.test.notLinked' })
    else if (res.error === 'too-soon') setTestMsg({ ok: false, key: 'telegram.test.tooSoon' })
    else setTestMsg({ ok: false, key: ERROR_KEYS[res.error] })
  }

  return (
    <div className="max-w-2xl" data-telegram-section="">
      <SectionHeader title={t('telegram.title')} description={t('telegram.intro')} />

      <p role="note" className={`mb-4 text-xs leading-relaxed text-subtle ${NOTICE_DESK.warning}`} data-telegram-privacy="">
        <ShieldAlert size={16} className="hidden shrink-0 desk:block desk:text-warning" aria-hidden />
        <span>
          <strong className="font-medium">{t('telegram.privacy.title')}. </strong>
          {t('telegram.privacy.body')} {t('telegram.scope')}
        </span>
      </p>

      <Card>
        <Row label={t('telegram.switch.label')} description={t('telegram.switch.desc')}>
          <Toggle
            checked={s.enabled}
            disabled={busy !== null || !s.secureStorage}
            label={t('telegram.switch.label')}
            onChange={(v) =>
              void run('enable', async () => {
                if (!api) return
                setTestMsg(null)
                setState(await api.invoke('telegram:setEnabled', { enabled: v }))
              })
            }
          />
        </Row>
        <Row label={t('telegram.status.label')}>
          <div aria-live="polite" role="status" data-telegram-status={s.phase} className="flex flex-col items-end gap-1 text-right">
            <Badge tone={statusTone}>{statusText}</Badge>
            {s.error && (
              <span className="max-w-[320px] text-xs text-danger">{t('telegram.status.error', { reason: t(ERROR_KEYS[s.error]) })}</span>
            )}
            {!s.secureStorage && !s.error && (
              <span className="max-w-[320px] text-xs text-danger">
                {t('telegram.status.error', { reason: t(ERROR_KEYS['no-secure-storage']) })}
              </span>
            )}
          </div>
        </Row>
        {s.pendingPermissions > 0 && <Row label={t('telegram.pending', { count: s.pendingPermissions })} />}
      </Card>

      <SubTitle>{t('telegram.steps.title')}</SubTitle>
      <Card>
        <Row label={t('telegram.step1.title')} description={t('telegram.step1.body')} layout="stack-narrow">
          <Button size="sm" onClick={() => void openExternalUrl(BOTFATHER_URL)}>
            <ExternalLink size={14} aria-hidden />
            {t('telegram.step1.open')}
          </Button>
        </Row>

        <Row label={t('telegram.step2.title')} description={s.botConfigured ? undefined : t('telegram.step2.body')} layout="stack-narrow">
          {s.botConfigured ? (
            <div className="text-right text-xs text-muted" data-telegram-bot="">
              <div>{t('telegram.step2.saved', { tail: s.tokenTail ?? '····' })}</div>
              {s.botUsername && <div>{t('telegram.step2.bot', { name: s.botUsername })}</div>}
            </div>
          ) : (
            <form
              className="flex items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault()
                void saveToken()
              }}
            >
              <TextInput
                type="password"
                name="telegram-bot-key"
                autoComplete="off"
                spellCheck={false}
                aria-label={t('telegram.step2.placeholder')}
                placeholder={t('telegram.step2.placeholder')}
                value={token}
                onChange={(e) => setToken(e.target.value)}
                className="w-56"
              />
              <Button
                type="submit"
                size="sm"
                variant="primary"
                loading={busy === 'token'}
                disabled={!token.trim() || busy !== null || !s.secureStorage}
              >
                {busy === 'token' ? t('telegram.step2.saving') : t('telegram.step2.save')}
              </Button>
            </form>
          )}
        </Row>
        {tokenError && (
          <div className="px-4 pb-3 desk:px-5">
            <ErrorText>{t(ERROR_KEYS[tokenError]).replace(/^./, (c) => c.toUpperCase())}</ErrorText>
          </div>
        )}

        <Row label={t('telegram.step3.title')} description={t('telegram.step3.body')} layout="stack-narrow">
          {s.botUsername ? (
            <Button size="sm" onClick={() => void openExternalUrl(`https://t.me/${s.botUsername}`)}>
              <ExternalLink size={14} aria-hidden />
              {t('telegram.step3.open')}
            </Button>
          ) : null}
        </Row>

        <Row
          label={t('telegram.step4.title')}
          description={s.phase === 'linked' ? undefined : t('telegram.step4.body')}
          layout="stack-narrow"
        >
          {s.phase === 'linking' && s.code ? (
            <div className="text-right" data-telegram-code="">
              <div className="font-mono text-2xl font-semibold tracking-[0.3em] text-fg" aria-label={s.code.split('').join(' ')}>
                {s.code}
              </div>
              <div className="mt-1 text-xs text-muted">
                {remaining > 0 ? t('telegram.step4.expires', { time: clock(remaining) }) : t('telegram.step4.expired')}
              </div>
              {s.attemptsLeft != null && s.attemptsLeft < 5 && (
                <div className="mt-0.5 text-xs text-warning">{t('telegram.step4.attempts', { count: s.attemptsLeft })}</div>
              )}
              <Button className="mt-2" size="sm" disabled={busy !== null} onClick={() => void act('code', 'telegram:startLinking')}>
                {t('telegram.step4.new')}
              </Button>
            </div>
          ) : s.phase === 'idle' ? (
            <div className="text-right text-xs text-muted">
              {locked ? (
                <div className="mb-2 text-warning">{t('telegram.step4.locked', { time: clock(lockLeft) })}</div>
              ) : (
                <div className="mb-2">{t('telegram.step4.expired')}</div>
              )}
              <Button
                size="sm"
                variant="primary"
                disabled={busy !== null || locked}
                onClick={() => void act('code', 'telegram:startLinking')}
              >
                {t('telegram.step4.new')}
              </Button>
            </div>
          ) : s.phase === 'linked' ? (
            <Badge tone="ok">{t('telegram.status.linked', { name: ownerName })}</Badge>
          ) : (
            <span className="text-xs text-muted">{s.phase === 'off' ? t('telegram.step4.turnOn') : ''}</span>
          )}
        </Row>
      </Card>

      {s.phase === 'linked' && (
        <>
          <SubTitle>{t('telegram.follow.title')}</SubTitle>
          <Card>
            <Row label={t('telegram.session.label')} description={t('telegram.follow.body')} layout="stack-narrow">
              <div className="flex flex-col items-end gap-1 text-right" data-telegram-session="">
                {s.activeSession ? (
                  <>
                    <span className="max-w-[320px] truncate text-sm text-fg" title={s.activeSession.title}>
                      {s.activeSession.title || t('telegram.msg.untitled')}
                    </span>
                    <span className="text-xs text-muted">{sessionKind}</span>
                    <Button size="sm" disabled={busy !== null} onClick={() => void act('release', 'telegram:releaseSession')}>
                      {t('telegram.session.release')}
                    </Button>
                  </>
                ) : (
                  <span className="text-xs text-muted">{t('telegram.session.none')}</span>
                )}
              </div>
            </Row>
            <Row label={t('telegram.write.label')} description={`${t('telegram.write.desc')} ${t('telegram.write.warn')}`}>
              <Toggle
                checked={s.allowWrite}
                disabled={busy !== null}
                label={t('telegram.write.label')}
                onChange={(v) => setFlag('write', 'telegram:setAllowWrite', v)}
              />
            </Row>
            <Row label={t('telegram.summaries.label')} description={t('telegram.summaries.desc')}>
              <Toggle
                checked={s.summariesOnly}
                disabled={busy !== null}
                label={t('telegram.summaries.label')}
                onChange={(v) => setFlag('summaries', 'telegram:setSummariesOnly', v)}
              />
            </Row>
          </Card>
          <p className="mt-2 text-xs leading-relaxed text-subtle" data-telegram-files-note="">
            {t('telegram.files.note')}
          </p>

          <SubTitle>{t('telegram.test.label')}</SubTitle>
          <Card>
            <Row label={t('telegram.test.label')} description={t('telegram.test.desc')} layout="stack-narrow">
              <div className="flex flex-col items-end gap-1">
                <Button size="sm" loading={busy === 'test'} disabled={busy !== null} onClick={() => void sendTest()}>
                  {t('telegram.test.send')}
                </Button>
                <span aria-live="polite" className={`text-xs ${testMsg?.ok ? 'text-success' : 'text-danger'}`}>
                  {testMsg ? t(testMsg.key).replace(/^./, (c) => c.toUpperCase()) : ''}
                </span>
              </div>
            </Row>
            <Row label={t('telegram.actions.unlink')} layout="stack-narrow">
              <Button size="sm" disabled={busy !== null} onClick={() => void act('unlink', 'telegram:unlink')}>
                {t('telegram.actions.unlink')}
              </Button>
            </Row>
          </Card>
        </>
      )}

      {(s.botConfigured || s.enabled) && (
        <>
          <SubTitle>{t('telegram.actions.stopAll')}</SubTitle>
          <Card>
            <Row label={t('telegram.actions.stopAll')} description={t('telegram.actions.stopAllDesc')} layout="stack-narrow">
              <Button size="sm" variant="danger" disabled={busy !== null} onClick={() => void act('panic', 'telegram:panic')}>
                {busy === 'panic' ? t('telegram.actions.working') : t('telegram.actions.stopAll')}
              </Button>
            </Row>
            {s.botConfigured && (
              <Row
                label={t('telegram.actions.removeBot')}
                description={confirmRemove ? t('telegram.actions.removeConfirm') : undefined}
                layout="stack-narrow"
              >
                {confirmRemove ? (
                  <div className="flex gap-2">
                    <Button size="sm" onClick={() => setConfirmRemove(false)}>
                      {t('telegram.actions.cancel')}
                    </Button>
                    <Button
                      size="sm"
                      variant="danger"
                      disabled={busy !== null}
                      onClick={() => {
                        setConfirmRemove(false)
                        void act('remove', 'telegram:removeBot')
                      }}
                    >
                      {t('telegram.actions.removeYes')}
                    </Button>
                  </div>
                ) : (
                  <Button size="sm" disabled={busy !== null} onClick={() => setConfirmRemove(true)}>
                    {t('telegram.actions.removeBot')}
                  </Button>
                )}
              </Row>
            )}
          </Card>
        </>
      )}

      <p className="mt-4 text-xs leading-relaxed text-subtle">{t('telegram.audit.note')}</p>
    </div>
  )
}
