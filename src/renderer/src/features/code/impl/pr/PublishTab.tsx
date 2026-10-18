/**
 * Pestaña «Publicar mi trabajo»: rama → guardar cambios (commit) → subir → abrir pull request → estado. Cada paso que saca algo del
 * equipo (subir, abrir el PR) pasa por un cuadro de confirmación que muestra rama, remoto y texto exactos.
 */
import { useCallback, useEffect, useId, useMemo, useState } from 'react'
import type { MsgKey } from '@shared/i18n'
import { buildPrTextPrompt, parsePrText } from '@shared/pr-prompts'
import { checkBranchName, checkPrTitle } from '@shared/pr-validate'
import type { SecretKind } from '@shared/secret-scan'
import type { PrGhInfo, PrPushPlan, PrRepoStatus, PrViewResult } from '@shared/ipc-pr'
import { maskSecretPatterns } from '@shared/redact-patterns'
import { ExternalLink, GitBranchPlus, Loader2, RefreshCw, ShieldAlert, Sparkles } from 'lucide-react'
import { getLang, useT } from '../../../../lib/i18n'
import { openExternalUrl } from '../../../../lib/open-external'
import { errorMessage, requireCode } from '../client'
import { askModel } from './pr-ai'
import { PrConfirm } from './PrConfirm'
import { PrStatusCard } from './PrStatusCard'
import { defaultBase, hasBlocks, isPushed, pickRemote } from './pr-logic'

interface Props {
  directory: string
  status: PrRepoStatus
  reload: () => Promise<void>
}

const inputCls =
  'w-full rounded-lg border border-border bg-bg px-2.5 py-1.5 text-sm outline-none focus:border-border-strong placeholder:text-subtle'
const btnPrimary =
  'flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-accent-fg hover:opacity-90 disabled:opacity-40'
const btnSecondary =
  'flex items-center gap-1.5 rounded-lg border border-border bg-elevated px-3 py-1.5 text-sm hover:bg-hover disabled:opacity-40'

function Section({ title, children }: { title: string; children: React.ReactNode }): React.JSX.Element {
  const id = useId()
  return (
    <section aria-labelledby={id} className="rounded-xl border border-border p-3">
      <h3 id={id} className="mb-2 text-sm font-semibold">
        {title}
      </h3>
      <div className="space-y-2">{children}</div>
    </section>
  )
}

function Msg({ tone, children }: { tone: 'ok' | 'error' | 'info'; children: React.ReactNode }): React.JSX.Element {
  const cls = tone === 'ok' ? 'bg-success/10 text-success' : tone === 'error' ? 'bg-danger/10 text-danger' : 'bg-hover text-muted'
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className={`rounded-lg px-2.5 py-1.5 text-xs leading-relaxed ${cls}`}>
      {children}
    </div>
  )
}

function GhNotice({
  gh,
  onRecheck,
  checking
}: {
  gh: PrGhInfo | null
  onRecheck: () => void
  checking: boolean
}): React.JSX.Element | null {
  const t = useT()
  if (!gh) return <div className="text-xs text-muted">{t('pr.gh.checking')}</div>
  if (gh.state === 'ready')
    return <div className="text-xs text-muted">{gh.account ? t('pr.gh.ready', { account: gh.account }) : t('pr.gh.readyNoName')}</div>
  const k = gh.state === 'missing' ? 'missing' : gh.state === 'unauthenticated' ? 'unauth' : 'unsupported'
  return (
    <div role="status" className="space-y-1.5 rounded-lg border border-warning/40 bg-warning/10 px-2.5 py-2 text-xs leading-relaxed">
      <div className="font-medium">{t(`pr.gh.${k}.title` as MsgKey)}</div>
      <div>{t(`pr.gh.${k}.body` as MsgKey)}</div>
      {gh.state !== 'unsupported-host' && (
        <button type="button" onClick={onRecheck} disabled={checking} className={btnSecondary}>
          {checking ? <Loader2 size={13} className="animate-spin" aria-hidden="true" /> : <RefreshCw size={13} aria-hidden="true" />}
          {t('pr.gh.recheck')}
        </button>
      )}
    </div>
  )
}

function kindsText(kinds: SecretKind[] | undefined, t: (key: MsgKey) => string): string {
  return (kinds ?? []).map((k) => t(`pr.secret.${k}` as MsgKey)).join(', ')
}

export function PublishTab({ directory, status, reload }: Props): React.JSX.Element {
  const t = useT()
  const native = requireCode()
  const [remote, setRemote] = useState<string | null>(() => pickRemote(status.remotes))
  const [gh, setGh] = useState<PrGhInfo | null>(null)
  const [ghChecking, setGhChecking] = useState(false)

  // ── rama ──
  const [newBranch, setNewBranch] = useState('')
  const [branchBusy, setBranchBusy] = useState(false)
  const [branchMsg, setBranchMsg] = useState<string | null>(null)
  const [branchErr, setBranchErr] = useState<string | null>(null)
  const branchCheck = newBranch ? checkBranchName(newBranch) : null

  // ── subir ──
  const [plan, setPlan] = useState<PrPushPlan | null>(null)
  const [planBusy, setPlanBusy] = useState(false)
  const [confirmPush, setConfirmPush] = useState(false)
  const [pushBusy, setPushBusy] = useState(false)
  const [pushErr, setPushErr] = useState<string | null>(null)
  const [pushMsg, setPushMsg] = useState<string | null>(null)

  // ── pull request ──
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [base, setBase] = useState(() => defaultBase(status))
  const [draft, setDraft] = useState(false)
  const [suggesting, setSuggesting] = useState(false)
  const [suggestNote, setSuggestNote] = useState<string | null>(null)
  const [makeErr, setMakeErr] = useState<string | null>(null)
  const [confirmMake, setConfirmMake] = useState(false)
  const [makeBusy, setMakeBusy] = useState(false)
  const [madeMsg, setMadeMsg] = useState<string | null>(null)

  // ── estado ──
  const [view, setView] = useState<{ loading: boolean; data: PrViewResult | null; error: string | null }>({
    loading: false,
    data: null,
    error: null
  })

  const remoteInfo = useMemo(() => status.remotes.find((r) => r.name === remote) ?? null, [status.remotes, remote])
  const pushed = isPushed(status)
  const branch = status.branch

  const checkGh = useCallback(async () => {
    if (!remote) return
    setGhChecking(true)
    try {
      setGh(await native.pr.gh(directory, remote))
    } catch {
      setGh({ state: 'missing', account: null })
    } finally {
      setGhChecking(false)
    }
  }, [native, directory, remote])

  useEffect(() => {
    setGh(null)
    void checkGh()
  }, [checkGh])

  const loadView = useCallback(async () => {
    if (!remote || !branch) return
    setView((v) => ({ ...v, loading: true, error: null }))
    try {
      setView({ loading: false, data: await native.pr.view(directory, remote, branch), error: null })
    } catch (err) {
      setView({ loading: false, data: null, error: errorMessage(err) })
    }
  }, [native, directory, remote, branch])

  useEffect(() => {
    if (gh?.state === 'ready' && pushed) void loadView()
  }, [gh?.state, pushed, loadView])

  const createBranch = async (): Promise<void> => {
    if (!newBranch || !branchCheck?.ok) return
    setBranchBusy(true)
    setBranchErr(null)
    setBranchMsg(null)
    try {
      const r = await native.pr.createBranch(directory, newBranch)
      setBranchMsg(t('pr.branch.created', { branch: r.branch }))
      setNewBranch('')
      setPlan(null)
      await reload()
    } catch (err) {
      setBranchErr(errorMessage(err))
    } finally {
      setBranchBusy(false)
    }
  }

  const openPushPlan = async (): Promise<void> => {
    if (!remote) return
    setPlanBusy(true)
    setPushErr(null)
    setPushMsg(null)
    try {
      const p = await native.pr.pushPlan(directory, remote)
      setPlan(p)
      if (!hasBlocks(p) && !p.nothingToPush) setConfirmPush(true)
    } catch (err) {
      setPlan(null)
      setPushErr(errorMessage(err))
    } finally {
      setPlanBusy(false)
    }
  }

  const doPush = async (typed: string): Promise<void> => {
    if (!plan) return
    setPushBusy(true)
    setPushErr(null)
    try {
      const r = await native.pr.push({
        cwd: directory,
        remote: plan.remote,
        branch: plan.branch,
        expectHead: plan.head,
        ...(plan.protected ? { typedBranch: typed } : {})
      })
      setConfirmPush(false)
      setPlan(null)
      setPushMsg(t('pr.push.done', { branch: r.branch, remote: r.remote }))
      await reload()
    } catch (err) {
      setPushErr(errorMessage(err))
    } finally {
      setPushBusy(false)
    }
  }

  const suggest = async (): Promise<void> => {
    if (!remote) return
    setSuggesting(true)
    setMakeErr(null)
    setSuggestNote(null)
    try {
      const ch = await native.pr.changes(directory, remote, base)
      const prompt = buildPrTextPrompt({
        lang: getLang(),
        branch: branch ?? '',
        base,
        commits: ch.commits.map((c) => `${c.short} ${c.subject}`).join('\n'),
        stat: ch.stat,
        diff: ch.diff
      })
      const out = parsePrText(await askModel(directory, prompt))
      if (out.title) setTitle(out.title)
      setBody(out.body)
      setSuggestNote(t('pr.make.suggested'))
    } catch (err) {
      setMakeErr(t('pr.make.suggestFailed', { error: errorMessage(err) }))
    } finally {
      setSuggesting(false)
    }
  }

  const maskedTitle = maskSecretPatterns(title.trim())
  const maskedBody = maskSecretPatterns(body)
  const titleOk = checkPrTitle(maskedTitle).ok
  const baseOk = checkBranchName(base).ok
  const sameBranch = !!branch && branch === base
  const canMake = gh?.state === 'ready' && pushed && titleOk && baseOk && !sameBranch && !!remote

  const doMake = async (): Promise<void> => {
    if (!remote || !branch || !status.head) return
    setMakeBusy(true)
    setMakeErr(null)
    try {
      const r = await native.pr.create({
        cwd: directory,
        remote,
        title: maskedTitle,
        body: maskedBody,
        base,
        draft,
        branch,
        expectHead: status.head
      })
      setConfirmMake(false)
      setMadeMsg(r.number ? t('pr.make.done', { number: r.number }) : t('pr.make.doneNoNumber'))
      void loadView()
    } catch (err) {
      setMakeErr(errorMessage(err))
    } finally {
      setMakeBusy(false)
    }
  }

  if (status.remotes.length === 0) return <Msg tone="info">{t('pr.noRemote')}</Msg>

  return (
    <div className="space-y-3">
      {/* 1. Rama */}
      <Section title={t('pr.step.branch')}>
        <div className="text-xs text-muted">{branch ? t('pr.branch.current', { branch }) : t('pr.branch.detached')}</div>
        {status.protected && branch && <Msg tone="info">{t('pr.branch.protectedWarn', { branch })}</Msg>}
        {!status.protected && !!branch && <div className="text-xs text-muted">{t('pr.branch.okHint')}</div>}
        <div className="flex items-end gap-2">
          <div className="min-w-0 flex-1">
            <label htmlFor="pr-new-branch" className="mb-1 block text-xs font-medium text-muted">
              {t('pr.branch.newLabel')}
            </label>
            <input
              id="pr-new-branch"
              value={newBranch}
              onChange={(e) => setNewBranch(e.target.value.replace(/\s+/g, '-'))}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.nativeEvent.isComposing && !branchBusy) void createBranch()
              }}
              placeholder={t('pr.branch.placeholder')}
              autoComplete="off"
              spellCheck={false}
              aria-invalid={!!newBranch && !branchCheck?.ok}
              aria-describedby="pr-new-branch-hint"
              className={`${inputCls} font-mono`}
            />
          </div>
          <button type="button" onClick={() => void createBranch()} disabled={branchBusy || !branchCheck?.ok} className={btnSecondary}>
            {branchBusy ? (
              <Loader2 size={13} className="animate-spin" aria-hidden="true" />
            ) : (
              <GitBranchPlus size={13} aria-hidden="true" />
            )}
            {t('pr.branch.create')}
          </button>
        </div>
        <div id="pr-new-branch-hint" className="text-xs text-muted">
          {newBranch && !branchCheck?.ok ? <span className="text-danger">{t('pr.branch.invalid')}</span> : null}
        </div>
        {branchMsg && <Msg tone="ok">{branchMsg}</Msg>}
        {branchErr && <Msg tone="error">{branchErr}</Msg>}
      </Section>

      {/* 2. Guardar cambios */}
      <Section title={t('pr.step.commit')}>
        <div className="text-xs leading-relaxed text-muted">
          {status.dirtyCount > 0 ? t('pr.commit.dirty', { count: status.dirtyCount }) : t('pr.commit.clean')}
        </div>
        <div className="text-xs text-muted">
          {status.upstream ? (status.ahead > 0 ? t('pr.commit.ahead', { count: status.ahead }) : t('pr.commit.noneAhead')) : null}
        </div>
      </Section>

      {/* 3. Subir */}
      <Section title={t('pr.step.push')}>
        {status.remotes.length > 1 && (
          <div>
            <label htmlFor="pr-remote" className="mb-1 block text-xs font-medium text-muted">
              {t('pr.push.remote')}
            </label>
            <select id="pr-remote" value={remote ?? ''} onChange={(e) => setRemote(e.target.value)} className={inputCls}>
              {status.remotes.map((r) => (
                <option key={r.name} value={r.name}>
                  {r.name} — {r.url}
                </option>
              ))}
            </select>
          </div>
        )}
        {status.remotes.length === 1 && remoteInfo && (
          <div className="text-xs text-muted">
            {t('pr.push.remote')}: <span className="font-mono">{remoteInfo.name}</span> ·{' '}
            <span className="font-mono break-all">{remoteInfo.url}</span>
          </div>
        )}
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => void openPushPlan()} disabled={planBusy || !remote || !branch} className={btnPrimary}>
            {planBusy && <Loader2 size={13} className="animate-spin" aria-hidden="true" />}
            {t('pr.push.review')}
          </button>
        </div>
        {plan?.nothingToPush && !pushMsg && (
          <Msg tone="info">{plan.remoteBranchExists || pushed ? t('pr.push.upToDate') : t('pr.push.nothing')}</Msg>
        )}
        {plan && hasBlocks(plan) && (
          <div role="alert" className="space-y-1.5 rounded-lg border border-danger/40 bg-danger/10 px-2.5 py-2 text-xs leading-relaxed">
            <div className="flex items-center gap-1.5 font-medium text-danger">
              <ShieldAlert size={14} aria-hidden="true" /> {t('pr.push.blocked.title')}
            </div>
            <ul className="list-disc space-y-0.5 pl-4">
              {plan.blocked.map((b, i) => (
                <li key={`${b.kind}-${b.file ?? ''}-${i}`}>
                  {b.kind === 'secret-file' && t('pr.push.blocked.file', { file: b.file ?? '?' })}
                  {b.kind === 'secret-content' && t('pr.push.blocked.content', { file: b.file ?? '?', kinds: kindsText(b.secrets, t) })}
                  {b.kind === 'scan-incomplete' && t('pr.push.blocked.scan')}
                </li>
              ))}
            </ul>
            <div>{t('pr.push.blocked.help')}</div>
          </div>
        )}
        {pushMsg && <Msg tone="ok">{pushMsg}</Msg>}
        {pushErr && !confirmPush && <Msg tone="error">{pushErr}</Msg>}
      </Section>

      {/* 4. Abrir pull request */}
      <Section title={t('pr.step.open')}>
        <GhNotice gh={gh} onRecheck={() => void checkGh()} checking={ghChecking} />
        {gh?.state === 'ready' && (
          <>
            {!pushed && <Msg tone="info">{t('pr.make.needPush')}</Msg>}
            {sameBranch && <Msg tone="info">{t('pr.make.sameBranch')}</Msg>}
            <div>
              <label htmlFor="pr-base" className="mb-1 block text-xs font-medium text-muted">
                {t('pr.make.base')}
              </label>
              <input
                id="pr-base"
                value={base}
                onChange={(e) => setBase(e.target.value.trim())}
                autoComplete="off"
                spellCheck={false}
                aria-invalid={!baseOk}
                className={`${inputCls} font-mono`}
              />
            </div>
            <div className="flex items-center justify-between gap-2">
              <label htmlFor="pr-title" className="text-xs font-medium text-muted">
                {t('pr.make.title')}
              </label>
              <button type="button" onClick={() => void suggest()} disabled={suggesting || !pushed || !baseOk} className={btnSecondary}>
                {suggesting ? <Loader2 size={13} className="animate-spin" aria-hidden="true" /> : <Sparkles size={13} aria-hidden="true" />}
                {t('pr.make.suggest')}
              </button>
            </div>
            <input
              id="pr-title"
              value={title}
              onChange={(e) => setTitle(e.target.value.replace(/[\r\n]+/g, ' '))}
              maxLength={256}
              className={inputCls}
            />
            <div>
              <label htmlFor="pr-body" className="mb-1 block text-xs font-medium text-muted">
                {t('pr.make.body')}
              </label>
              <textarea id="pr-body" value={body} onChange={(e) => setBody(e.target.value)} rows={7} className={`${inputCls} resize-y`} />
            </div>
            {suggesting && <Msg tone="info">{t('pr.make.suggesting')}</Msg>}
            {suggestNote && <Msg tone="info">{suggestNote}</Msg>}
            <label className="flex items-center gap-1.5 text-xs text-muted">
              <input type="checkbox" checked={draft} onChange={(e) => setDraft(e.target.checked)} className="accent-[var(--accent)]" />
              {t('pr.make.draft')}
            </label>
            <div>
              <button type="button" onClick={() => setConfirmMake(true)} disabled={!canMake} className={btnPrimary}>
                {t('pr.make.review')}
              </button>
            </div>
          </>
        )}
        {makeErr && !confirmMake && <Msg tone="error">{makeErr}</Msg>}
        {madeMsg && <Msg tone="ok">{madeMsg}</Msg>}
      </Section>

      {/* 5. Estado */}
      <Section title={t('pr.step.status')}>
        {gh?.state !== 'ready' || !pushed ? (
          <div className="text-xs text-muted">{t('pr.status.none')}</div>
        ) : (
          <PrStatusCard
            loading={view.loading}
            error={view.error}
            data={view.data}
            onRefresh={() => void loadView()}
            onOpen={(u) => void openExternalUrl(u)}
          />
        )}
      </Section>

      {confirmPush && plan && (
        <PrConfirm
          title={t('pr.push.confirm.title')}
          warn={t('pr.push.confirm.warn')}
          rows={[
            { label: t('pr.push.confirm.remote'), value: plan.remote, mono: true },
            { label: t('pr.push.confirm.url'), value: plan.remoteUrl, mono: true },
            { label: t('pr.push.confirm.branch'), value: plan.branch, mono: true },
            { label: t('pr.push.confirm.commits'), value: String(plan.commitCount) },
            { label: t('pr.push.confirm.files'), value: String(plan.fileCount) }
          ]}
          text={{ label: t('pr.push.confirm.commits'), value: plan.commits.map((c) => `${c.short}  ${c.subject}`).join('\n') }}
          extra={
            <div className="space-y-1 text-xs text-muted">
              <div>{plan.remoteBranchExists ? t('pr.push.confirm.existingBranch') : t('pr.push.confirm.newBranch')}</div>
              {plan.dirtyCount > 0 && <div>{t('pr.push.confirm.dirty')}</div>}
            </div>
          }
          typed={
            plan.protected
              ? {
                  expected: plan.branch,
                  prompt: t('pr.push.confirm.protected', { branch: plan.branch }),
                  label: t('pr.push.confirm.typedLabel')
                }
              : undefined
          }
          confirmLabel={t('pr.push.confirm.go')}
          busy={pushBusy}
          error={pushErr}
          onConfirm={(typed) => void doPush(typed)}
          onCancel={() => {
            setConfirmPush(false)
            setPushErr(null)
          }}
        />
      )}

      {confirmMake && remote && branch && (
        <PrConfirm
          title={t('pr.make.confirm.title')}
          warn={t('pr.make.confirm.warn')}
          rows={[
            { label: t('pr.make.confirm.repo'), value: remoteInfo?.slug ?? remoteInfo?.url ?? remote, mono: true },
            { label: t('pr.make.confirm.fromTo'), value: `${branch} → ${base}`, mono: true },
            { label: t('pr.make.confirm.title2'), value: maskedTitle }
          ]}
          text={{ label: t('pr.make.confirm.body'), value: maskedBody }}
          extra={draft ? <div className="text-xs text-muted">{t('pr.make.confirm.draft')}</div> : undefined}
          confirmLabel={t('pr.make.confirm.go')}
          busy={makeBusy}
          error={makeErr}
          onConfirm={() => void doMake()}
          onCancel={() => {
            setConfirmMake(false)
            setMakeErr(null)
          }}
        />
      )}
      {madeMsg && view.data?.pr && (
        <button type="button" onClick={() => void openExternalUrl(view.data!.pr!.url)} className={btnSecondary}>
          <ExternalLink size={13} aria-hidden="true" /> {t('pr.status.openWeb')}
        </button>
      )}
    </div>
  )
}
