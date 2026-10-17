/**
 * Ajustes › Importar: trae instrucciones de proyecto (`CLAUDE.md` → `AGENTS.md`) y conectores MCP de otras herramientas.
 * La persona elige la carpeta o el archivo en el diálogo nativo (lo abre main); aquí solo se muestra la vista previa (sin secretos),
 * se marca elemento por elemento y se confirma. Los conectores entran desactivados. Ver `src/main/extras/import-service.ts`.
 */
import { useState } from 'react'
import { AlertTriangle, CheckCircle2, FileText, FolderOpen, Loader2, ShieldCheck, Plug, XCircle } from 'lucide-react'
import type { ImportApplyResult, ImportItem, ImportPreview, ImportReason, ImportSource } from '@shared/ipc-extras'
import type { MsgKey } from '@shared/i18n'
import { Button } from '../../../components/Button'
import { useT } from '../../../lib/i18n'
import { errorMessage } from '../../../lib/opencode'
import { getExtras } from './extras'
import { Badge, Card, ErrorText, SectionHeader, SubTitle } from './ui'

export interface ImportSectionProps {
  /** Salta a otra sección de Ajustes (la inyecta la vista de Ajustes). */
  goTo?: (id: 'mcp' | 'instructions') => void
}

function ReasonList({ reasons }: { reasons: ImportReason[] }): React.JSX.Element | null {
  const t = useT()
  if (reasons.length === 0) return null
  return (
    <ul className="mt-1 space-y-0.5 text-xs text-muted">
      {reasons.map((r, i) => (
        <li key={`${r.code}-${i}`} data-reason={r.code}>
          {t(`import.reason.${r.code}` as MsgKey, { detail: r.detail ?? '' })}
        </li>
      ))}
    </ul>
  )
}

function ItemRow({
  item,
  checked,
  onChange,
  result
}: {
  item: ImportItem
  checked: boolean
  onChange: (v: boolean) => void
  result?: { ok: boolean; error?: string }
}): React.JSX.Element {
  const t = useT()
  const ok = item.status === 'ok'
  const Icon = item.kind === 'mcp' ? Plug : FileText
  return (
    <li
      data-row=""
      data-import-item={item.id}
      className="flex items-start gap-3 border-b border-border px-4 py-3 last:border-b-0 desk:px-5"
    >
      {ok ? (
        <input
          type="checkbox"
          checked={checked}
          disabled={!!result}
          onChange={(e) => onChange(e.target.checked)}
          aria-label={t('import.item.pick', { name: item.name })}
          className="mt-1 size-4 shrink-0 accent-[var(--accent)]"
        />
      ) : (
        <XCircle size={16} className="mt-0.5 shrink-0 text-subtle" aria-hidden />
      )}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
          <Icon size={14} className="shrink-0 text-muted" aria-hidden />
          <span className="break-all">{item.name}</span>
          <span className="text-xs font-normal text-subtle">{t('import.item.from', { origin: item.origin })}</span>
          {item.kind === 'mcp' && ok && <Badge tone="muted">{t('import.item.disabledNote')}</Badge>}
        </div>
        {item.summary && <div className="mt-0.5 font-mono text-xs break-all text-muted">{item.summary}</div>}
        {item.envRefs.length > 0 && (
          <div className="mt-1 text-xs text-muted">{t('import.item.envRefs', { names: item.envRefs.join(', ') })}</div>
        )}
        <ReasonList reasons={item.reasons.filter((r) => r.code !== 'values-referenced' || item.envRefs.length === 0)} />
        {result &&
          (result.ok ? (
            <div className="mt-1.5 flex items-center gap-1.5 text-xs text-success" role="status">
              <CheckCircle2 size={13} aria-hidden />
              {item.kind === 'mcp' ? t('import.result.mcpOk') : t('import.result.instrOk')}
            </div>
          ) : (
            <div className="mt-1.5 text-xs text-danger" role="alert">
              {t('import.result.fail', { error: result.error ?? '' })}
            </div>
          ))}
      </div>
    </li>
  )
}

export function ImportSection({ goTo }: ImportSectionProps = {}): React.JSX.Element {
  const t = useT()
  const [busy, setBusy] = useState<ImportSource | 'apply' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [preview, setPreview] = useState<ImportPreview | null>(null)
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [done, setDone] = useState<ImportApplyResult | null>(null)

  const pick = async (source: ImportSource): Promise<void> => {
    const extras = getExtras()
    if (!extras) return
    setBusy(source)
    setError(null)
    try {
      const p = await extras.invoke('extras:import:pick', { source })
      if (p) {
        setPreview(p)
        setChecked(new Set())
        setDone(null)
      }
    } catch (err) {
      setError(t('import.error', { error: errorMessage(err) }))
    } finally {
      setBusy(null)
    }
  }

  const apply = async (): Promise<void> => {
    const extras = getExtras()
    if (!extras || !preview || checked.size === 0) return
    setBusy('apply')
    setError(null)
    try {
      setDone(await extras.invoke('extras:import:apply', { token: preview.token, ids: [...checked] }))
    } catch (err) {
      setError(t('import.error', { error: errorMessage(err) }))
    } finally {
      setBusy(null)
    }
  }

  const toggle = (id: string, v: boolean): void =>
    setChecked((prev) => {
      const next = new Set(prev)
      if (v) next.add(id)
      else next.delete(id)
      return next
    })

  const results = new Map((done?.results ?? []).map((r) => [r.id, r]))
  const importable = preview?.items.filter((i) => i.status === 'ok') ?? []
  const groups: { key: 'instructions' | 'mcp'; items: ImportItem[] }[] = [
    { key: 'instructions', items: importable.filter((i) => i.kind === 'instructions') },
    { key: 'mcp', items: importable.filter((i) => i.kind === 'mcp') }
  ]
  const dropped = preview?.items.filter((i) => i.status === 'discarded') ?? []
  const anyOkMcp = !!done && (preview?.items ?? []).some((i) => i.kind === 'mcp' && results.get(i.id)?.ok)
  const anyOkInstr = !!done && (preview?.items ?? []).some((i) => i.kind === 'instructions' && results.get(i.id)?.ok)

  return (
    <div data-testid="import-section">
      <SectionHeader title={t('import.title')} description={t('import.intro')} />

      <Card>
        <div className="px-4 py-3 desk:px-5 desk:py-4">
          <div className="flex items-center gap-2 text-sm font-medium">
            <ShieldCheck size={15} className="text-accent" aria-hidden /> {t('import.guarantee.title')}
          </div>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-xs leading-relaxed text-muted">
            <li>{t('import.guarantee.chosen')}</li>
            <li>{t('import.guarantee.secrets')}</li>
            <li>{t('import.guarantee.disabled')}</li>
            <li>{t('import.guarantee.nothingRuns')}</li>
          </ul>
        </div>
      </Card>

      <div className="mt-4 grid gap-3 @md:grid-cols-2">
        {(
          [
            {
              source: 'project-folder',
              icon: FolderOpen,
              title: 'import.source.folder.title',
              desc: 'import.source.folder.desc',
              btn: 'import.source.folder.button'
            },
            {
              source: 'mcp-file',
              icon: FileText,
              title: 'import.source.file.title',
              desc: 'import.source.file.desc',
              btn: 'import.source.file.button'
            }
          ] as const
        ).map(({ source, icon: Icon, title, desc, btn }) => (
          <Card key={source}>
            <div className="flex h-full flex-col px-4 py-3 desk:px-5 desk:py-4">
              <div className="flex items-center gap-2 text-sm font-medium">
                <Icon size={15} className="text-muted" aria-hidden /> {t(title)}
              </div>
              <p className="mt-1 flex-1 text-xs leading-relaxed text-muted">{t(desc)}</p>
              <div className="mt-3">
                <Button
                  variant="secondary"
                  size="sm"
                  data-import-pick={source}
                  onClick={() => void pick(source)}
                  disabled={busy !== null || !getExtras()}
                >
                  {busy === source ? <Loader2 size={14} className="animate-spin" /> : <Icon size={14} />}{' '}
                  {busy === source ? t('import.picking') : t(btn)}
                </Button>
              </div>
            </div>
          </Card>
        ))}
      </div>

      {error && (
        <div className="mt-3" role="alert">
          <ErrorText>{error}</ErrorText>
        </div>
      )}

      {preview && (
        <div data-testid="import-preview">
          <SubTitle>{t('import.preview.title', { label: preview.label })}</SubTitle>
          {preview.items.length === 0 ? (
            <Card>
              <p className="px-4 py-3 text-sm text-muted desk:px-5">{t('import.preview.empty', { label: preview.label })}</p>
            </Card>
          ) : (
            <>
              <p className="mb-3 text-xs text-muted">{t('import.preview.help')}</p>
              {groups
                .filter((g) => g.items.length > 0)
                .map((g) => (
                  <div key={g.key} className="mb-4">
                    <h4 className="mb-1.5 text-xs font-semibold text-subtle">
                      {t(g.key === 'mcp' ? 'import.group.mcp' : 'import.group.instructions')}
                    </h4>
                    <Card>
                      <ul>
                        {g.items.map((i) => (
                          <ItemRow
                            key={i.id}
                            item={i}
                            checked={checked.has(i.id)}
                            onChange={(v) => toggle(i.id, v)}
                            result={results.get(i.id)}
                          />
                        ))}
                      </ul>
                    </Card>
                  </div>
                ))}
              {dropped.length > 0 && (
                <div className="mb-4" data-testid="import-discarded">
                  <h4 className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-subtle">
                    <AlertTriangle size={13} aria-hidden /> {t('import.group.discarded')}
                  </h4>
                  <Card>
                    <ul>
                      {dropped.map((i) => (
                        <ItemRow key={i.id} item={i} checked={false} onChange={() => undefined} />
                      ))}
                    </ul>
                  </Card>
                </div>
              )}
              {importable.length > 0 && !done && (
                <div className="flex flex-wrap items-center gap-3">
                  <Button
                    variant="primary"
                    onClick={() => void apply()}
                    disabled={checked.size === 0 || busy !== null}
                    data-import-apply=""
                  >
                    {busy === 'apply' ? <Loader2 size={14} className="animate-spin" /> : null}
                    {busy === 'apply' ? t('import.applying') : t('import.apply', { count: checked.size })}
                  </Button>
                  {checked.size === 0 && <span className="text-xs text-subtle">{t('import.apply.none')}</span>}
                </div>
              )}
              {done && (
                <div className="flex flex-wrap items-center gap-2" data-testid="import-done">
                  {anyOkMcp && goTo && (
                    <Button variant="secondary" size="sm" onClick={() => goTo('mcp')}>
                      {t('import.goMcp')}
                    </Button>
                  )}
                  {anyOkInstr && goTo && (
                    <Button variant="secondary" size="sm" onClick={() => goTo('instructions')}>
                      {t('import.goInstructions')}
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setPreview(null)
                      setDone(null)
                    }}
                  >
                    {t('import.again')}
                  </Button>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}
