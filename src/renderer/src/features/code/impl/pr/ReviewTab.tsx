/**
 * Pestaña «Revisar un pull request»: la IA lee el diff de un PR (propio o ajeno) y PROPONE comentarios. No se publica nada hasta que la
 * persona los edita, marca los que quiere y confirma en un cuadro que muestra el texto exacto. El contenido del PR es DATO, no instrucciones.
 */
import { useState } from 'react'
import { buildReviewPrompt, parseReview } from '@shared/pr-prompts'
import { rightSideLines } from '@shared/pr-diff-lines'
import { parsePrRef } from '@shared/pr-validate'
import type { PrRepoStatus, PrReviewInfo } from '@shared/ipc-pr'
import { ExternalLink, Loader2, Sparkles } from 'lucide-react'
import { getLang, useT } from '../../../../lib/i18n'
import { openExternalUrl } from '../../../../lib/open-external'
import { errorMessage, requireCode } from '../client'
import { askModel } from './pr-ai'
import { PrConfirm } from './PrConfirm'
import { commentLabel, selectedComments, toReviewItems, type ReviewItem } from './pr-logic'
import { pickRemote } from './pr-logic'

interface Props {
  directory: string
  status: PrRepoStatus
}

const inputCls =
  'w-full rounded-lg border border-border bg-bg px-2.5 py-1.5 text-sm outline-none focus:border-border-strong placeholder:text-subtle'

export function ReviewTab({ directory, status }: Props): React.JSX.Element {
  const t = useT()
  const native = requireCode()
  const remote = pickRemote(status.remotes)
  const [ref, setRef] = useState('')
  const [phase, setPhase] = useState<'idle' | 'reading' | 'thinking'>('idle')
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<PrReviewInfo | null>(null)
  const [summary, setSummary] = useState('')
  const [items, setItems] = useState<ReviewItem[]>([])
  const [empty, setEmpty] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const [posting, setPosting] = useState(false)
  const [postErr, setPostErr] = useState<string | null>(null)
  const [posted, setPosted] = useState<{ text: string; url: string | null } | null>(null)

  const refOk = parsePrRef(ref).ok
  const [branchPrBusy, setBranchPrBusy] = useState(false)

  /** Rellena el número con el PR de la rama actual (si ya tiene uno). */
  const fillFromBranchPr = async (): Promise<void> => {
    if (!remote || !status.branch) return
    setBranchPrBusy(true)
    setError(null)
    try {
      const r = await native.pr.view(directory, remote, status.branch)
      if (r.pr) setRef(String(r.pr.number))
      else setError(t('pr.status.none'))
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBranchPrBusy(false)
    }
  }
  const busy = phase !== 'idle'
  const slug = status.remotes.find((r) => r.name === remote)?.slug ?? remote ?? ''

  const run = async (): Promise<void> => {
    if (!remote || !refOk) return
    setError(null)
    setPosted(null)
    setInfo(null)
    setItems([])
    setSummary('')
    setEmpty(false)
    setPhase('reading')
    try {
      const data = await native.pr.reviewInfo(directory, remote, ref.trim())
      setInfo(data)
      setPhase('thinking')
      const prompt = buildReviewPrompt({
        lang: getLang(),
        number: data.number,
        title: data.title,
        body: data.body,
        author: data.author,
        base: data.base,
        head: data.head,
        diff: data.diff,
        truncated: data.truncated
      })
      const answer = await askModel(directory, prompt)
      const parsed = parseReview(answer, rightSideLines(data.diff))
      if (!parsed) throw new Error(t('pr.rev.unreadable'))
      setSummary(parsed.summary)
      setItems(toReviewItems(parsed.comments))
      setEmpty(parsed.comments.length === 0)
    } catch (err) {
      setError(t('pr.rev.failed', { error: errorMessage(err) }))
    } finally {
      setPhase('idle')
    }
  }

  const chosen = selectedComments(items)
  const canPublish = !!info && (chosen.length > 0 || summary.trim().length > 0) && !busy

  const publish = async (): Promise<void> => {
    if (!info || !remote) return
    setPosting(true)
    setPostErr(null)
    try {
      const r = await native.pr.postReview({
        cwd: directory,
        remote,
        number: info.number,
        headSha: info.headSha,
        summary: summary.trim(),
        comments: chosen
      })
      setConfirm(false)
      setPosted({ text: t('pr.rev.done', { inline: r.inline, summary: r.inSummary }), url: r.url })
      setItems([])
      setSummary('')
    } catch (err) {
      setPostErr(errorMessage(err))
    } finally {
      setPosting(false)
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-xs leading-relaxed text-muted">{t('pr.rev.intro')}</p>
      <div>
        <label htmlFor="pr-ref" className="mb-1 block text-xs font-medium text-muted">
          {t('pr.rev.ref')}
        </label>
        <div className="flex gap-2">
          <input
            id="pr-ref"
            value={ref}
            onChange={(e) => setRef(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.nativeEvent.isComposing && !busy && refOk) void run()
            }}
            placeholder={t('pr.rev.refPlaceholder')}
            autoComplete="off"
            spellCheck={false}
            aria-invalid={!!ref && !refOk}
            className={`${inputCls} font-mono`}
          />
          <button
            type="button"
            onClick={() => void run()}
            disabled={busy || !refOk || !remote}
            className="flex shrink-0 items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-accent-fg hover:opacity-90 disabled:opacity-40"
          >
            {busy ? <Loader2 size={13} className="animate-spin" aria-hidden="true" /> : <Sparkles size={13} aria-hidden="true" />}
            {t('pr.rev.run')}
          </button>
        </div>
        {ref && !refOk && <div className="mt-1 text-xs text-danger">{t('pr.err.refFormat')}</div>}
        {status.branch && (
          <button
            type="button"
            onClick={() => void fillFromBranchPr()}
            disabled={busy || branchPrBusy || !remote}
            className="mt-1.5 rounded-lg border border-border bg-elevated px-2.5 py-1 text-xs hover:bg-hover disabled:opacity-40"
          >
            {t('pr.rev.useBranch')}
          </button>
        )}
      </div>
      <div className="text-xs text-muted">{t('pr.rev.untrusted')}</div>

      {phase !== 'idle' && (
        <div role="status" className="flex items-center gap-2 text-xs text-muted">
          <Loader2 size={13} className="animate-spin" aria-hidden="true" />{' '}
          {phase === 'reading' ? t('pr.rev.reading') : t('pr.rev.thinking')}
        </div>
      )}
      {error && (
        <div role="alert" className="rounded-lg bg-danger/10 px-2.5 py-1.5 text-xs text-danger">
          {error}
        </div>
      )}
      {posted && (
        <div role="status" className="flex items-center gap-2 rounded-lg bg-success/10 px-2.5 py-1.5 text-xs text-success">
          <span className="min-w-0 flex-1">{posted.text}</span>
          {posted.url && (
            <button type="button" onClick={() => void openExternalUrl(posted.url!)} className="flex shrink-0 items-center gap-1 underline">
              <ExternalLink size={12} aria-hidden="true" /> {t('pr.rev.openWeb')}
            </button>
          )}
        </div>
      )}

      {info && (
        <div className="space-y-3 rounded-xl border border-border p-3">
          <div className="text-sm font-medium">{t('pr.rev.about', { number: info.number, title: info.title })}</div>
          {info.omittedFiles > 0 && <div className="text-xs text-muted">{t('pr.rev.omitted', { count: info.omittedFiles })}</div>}
          {info.truncated && <div className="text-xs text-warning">{t('pr.rev.truncated')}</div>}
          {phase === 'idle' && !error && (
            <>
              <div>
                <label htmlFor="pr-rev-summary" className="mb-1 block text-xs font-medium text-muted">
                  {t('pr.rev.summary')}
                </label>
                <textarea
                  id="pr-rev-summary"
                  value={summary}
                  onChange={(e) => setSummary(e.target.value)}
                  rows={4}
                  className={`${inputCls} resize-y`}
                />
              </div>
              <div className="text-xs font-medium text-muted">{t('pr.rev.comments')}</div>
              {empty && <div className="text-xs text-muted">{t('pr.rev.none')}</div>}
              <ul className="space-y-2">
                {items.map((it) => (
                  <li key={it.id} className="rounded-lg border border-border p-2">
                    <label className="flex items-center gap-2 text-xs">
                      <input
                        type="checkbox"
                        checked={it.include}
                        aria-label={`${t('pr.rev.include')}: ${commentLabel(it)}`}
                        onChange={(e) => setItems((all) => all.map((x) => (x.id === it.id ? { ...x, include: e.target.checked } : x)))}
                        className="accent-[var(--accent)]"
                      />
                      <span className="min-w-0 flex-1 truncate font-mono">{commentLabel(it)}</span>
                    </label>
                    {it.line === 0 && <div className="mt-0.5 text-xs text-muted">{t('pr.rev.general')}</div>}
                    <textarea
                      value={it.body}
                      aria-label={commentLabel(it)}
                      onChange={(e) => setItems((all) => all.map((x) => (x.id === it.id ? { ...x, body: e.target.value } : x)))}
                      rows={3}
                      className={`${inputCls} mt-1 resize-y`}
                    />
                  </li>
                ))}
              </ul>
              {!canPublish && items.length > 0 && chosen.length === 0 && !summary.trim() && (
                <div className="text-xs text-muted">{t('pr.rev.nothingSelected')}</div>
              )}
              <button
                type="button"
                onClick={() => setConfirm(true)}
                disabled={!canPublish}
                className="rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-accent-fg hover:opacity-90 disabled:opacity-40"
              >
                {t('pr.rev.publish')}
              </button>
            </>
          )}
        </div>
      )}

      {confirm && info && (
        <PrConfirm
          title={t('pr.rev.confirm.title')}
          warn={t('pr.rev.confirm.warn')}
          rows={[
            { label: t('pr.rev.confirm.pr'), value: `#${info.number} ${info.title}` },
            { label: t('pr.rev.confirm.repo'), value: String(slug), mono: true }
          ]}
          text={{
            label: t('pr.rev.confirm.summary'),
            value: summary.trim()
          }}
          extra={
            chosen.length > 0 ? (
              <div>
                <div className="mb-1 text-xs font-medium text-muted">{t('pr.rev.confirm.comments')}</div>
                <ul className="max-h-48 space-y-1.5 overflow-auto text-xs">
                  {chosen.map((c, i) => (
                    <li key={i} className="rounded-lg border border-border bg-bg p-2">
                      <div className="font-mono text-muted">{commentLabel(c)}</div>
                      <div className="break-words whitespace-pre-wrap">{c.body}</div>
                    </li>
                  ))}
                </ul>
              </div>
            ) : undefined
          }
          confirmLabel={t('pr.rev.confirm.go')}
          busy={posting}
          error={postErr}
          onConfirm={() => void publish()}
          onCancel={() => {
            setConfirm(false)
            setPostErr(null)
          }}
        />
      )}
    </div>
  )
}
