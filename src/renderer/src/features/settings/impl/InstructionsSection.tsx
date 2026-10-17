/**
 * Ajustes > Instrucciones: (1) instrucciones personalizadas globales de Chat y Code («cómo quiero que me respondas»)
 * y (2) las instrucciones de un proyecto de Code, que es el `AGENTS.md` de su carpeta (el motor lo lee solo).
 */
import { useEffect, useMemo, useState } from 'react'
import { Button } from '../../../components/Button'
import { Markdown } from '../../../components/Markdown'
import { useT } from '../../../lib/i18n'
import { useSettings } from '../../../stores/settings'
import { MAX_USER_INSTRUCTIONS } from '@shared/personal-context'
import { cw, hasTasksBridge } from '../../tasks/impl/bridge'
import { useCode } from '../../code/impl/store'
import { Card, ErrorText, SectionHeader, Select, SubTitle } from './ui'

const TEXTAREA =
  'w-full resize-y rounded-lg border border-border bg-bg px-3 py-2 text-sm outline-none transition focus:border-border-strong focus:ring-2 focus:ring-accent/15 placeholder:text-subtle'

function GlobalInstructions(): React.JSX.Element {
  const t = useT()
  const saved = useSettings((s) => s.settings.userInstructions)
  const update = useSettings((s) => s.update)
  const [value, setValue] = useState(saved)
  const [flash, setFlash] = useState(false)

  useEffect(() => setValue(saved), [saved])

  const save = (): void => {
    if (value === saved) return
    void update({ userInstructions: value }).then(() => {
      setFlash(true)
      setTimeout(() => setFlash(false), 1500)
    })
  }

  return (
    <Card>
      <div className="px-4 py-3 desk:px-5 desk:py-4">
        <div className="text-sm font-medium">{t('instr.global.label')}</div>
        <p className="mt-0.5 text-xs leading-relaxed text-muted">{t('instr.global.help')}</p>
        <textarea
          data-testid="user-instructions"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onBlur={save}
          maxLength={MAX_USER_INSTRUCTIONS}
          rows={6}
          placeholder={t('instr.global.placeholder')}
          aria-label={t('instr.global.label')}
          className={`mt-3 min-h-28 ${TEXTAREA}`}
        />
        <div className="mt-1 flex items-center justify-between text-xs text-subtle">
          <span>{t('instr.global.count', { count: value.length, max: MAX_USER_INSTRUCTIONS })}</span>
          {flash && <span className="text-accent">{t('instr.saved')}</span>}
        </div>
      </div>
    </Card>
  )
}

function ProjectInstructions(): React.JSX.Element {
  const t = useT()
  const openDirs = useCode((s) => s.openDirectories)
  const current = useCode((s) => s.directory)
  const dirs = useMemo(() => (current && !openDirs.includes(current) ? [...openDirs, current] : openDirs), [openDirs, current])
  const [folder, setFolder] = useState<string | null>(current ?? dirs[0] ?? null)
  const [text, setText] = useState('')
  const [original, setOriginal] = useState('')
  const [info, setInfo] = useState<{ path: string; exists: boolean } | null>(null)
  const [preview, setPreview] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  useEffect(() => {
    if (!folder || !hasTasksBridge()) return
    let cancelled = false
    setMsg(null)
    void cw('tasks:instr:get', { folder })
      .then((a) => {
        if (cancelled) return
        setText(a.content)
        setOriginal(a.content)
        setInfo({ path: a.path, exists: a.exists })
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setInfo(null)
        setMsg({ ok: false, text: t('instr.project.loadFailed', { error: err instanceof Error ? err.message : String(err) }) })
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [folder])

  const save = async (): Promise<void> => {
    if (!folder) return
    setBusy(true)
    setMsg(null)
    try {
      const a = await cw('tasks:instr:save', { folder, content: text })
      setOriginal(a.content)
      setInfo({ path: a.path, exists: a.exists })
      setMsg({ ok: true, text: t('instr.project.saved') })
    } catch (err) {
      setMsg({ ok: false, text: t('instr.project.failed', { error: err instanceof Error ? err.message : String(err) }) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <SubTitle>{t('instr.project.title')}</SubTitle>
      <Card>
        <div className="px-4 py-3 desk:px-5 desk:py-3.5" data-testid="project-instructions">
          <p className="text-xs leading-relaxed text-muted">{t('instr.project.intro')}</p>
          {dirs.length === 0 || !folder ? (
            <p className="mt-3 text-sm text-muted">{t('instr.project.none')}</p>
          ) : (
            <>
              <label className="mt-3 flex flex-col gap-1 text-xs text-muted">
                {t('instr.project.folder')}
                <Select value={folder} onChange={(e) => setFolder(e.target.value)} aria-label={t('instr.project.folder')}>
                  {dirs.map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </Select>
              </label>
              {info && (
                <p className="mt-2 break-all text-xs text-subtle">
                  {t('instr.project.path', { path: info.path })}
                  {!info.exists && ` · ${t('instr.project.willCreate')}`}
                </p>
              )}
              <div className="mt-3 inline-flex rounded-lg bg-hover/60 p-0.5" role="tablist">
                {([false, true] as const).map((p) => (
                  <button
                    key={String(p)}
                    type="button"
                    role="tab"
                    aria-selected={preview === p}
                    onClick={() => setPreview(p)}
                    className={`rounded-md px-3 py-1 text-xs font-medium ${preview === p ? 'bg-elevated text-fg shadow-xs' : 'text-muted hover:text-fg'}`}
                  >
                    {p ? t('instr.project.preview') : t('instr.project.edit')}
                  </button>
                ))}
              </div>
              {preview ? (
                <div
                  className="mt-2 min-h-32 rounded-lg border border-border bg-bg px-3 py-2 text-sm"
                  data-testid="project-instructions-preview"
                >
                  {text.trim() ? <Markdown text={text} /> : <p className="text-muted">{t('instr.project.previewEmpty')}</p>}
                </div>
              ) : (
                <textarea
                  data-testid="project-instructions-text"
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  rows={9}
                  placeholder={t('instr.project.placeholder')}
                  aria-label={t('instr.project.title')}
                  className={`mt-2 min-h-32 font-mono ${TEXTAREA}`}
                />
              )}
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <Button variant="primary" onClick={() => void save()} disabled={busy || text === original}>
                  {busy ? t('instr.project.saving') : t('instr.project.save')}
                </Button>
                {msg && (msg.ok ? <span className="text-xs text-accent">{msg.text}</span> : <ErrorText>{msg.text}</ErrorText>)}
              </div>
            </>
          )}
        </div>
      </Card>
    </>
  )
}

export function InstructionsSection(): React.JSX.Element {
  const t = useT()
  return (
    <div>
      <SectionHeader title={t('instr.title')} description={t('instr.intro')} />
      <GlobalInstructions />
      <ProjectInstructions />
    </div>
  )
}
