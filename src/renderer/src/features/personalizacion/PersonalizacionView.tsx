/**
 * Personalización (F8-B180): habilidades y conectores en una sola pantalla, con pestañas Habilidades / Conectores / Tuyos.
 * Una sola fuente de fichas: el catálogo empaquetado (`resources/catalogo/catalogo.json`); sin servidor ni cuentas. La lógica de
 * alta/baja/estado de conectores es la de Ajustes › Conectores (`useMcpConnections`); las habilidades pasan por `personalizacion:skills:*`.
 */
import { useMemo, useState } from 'react'
import {
  AlertTriangle,
  FolderPlus,
  Loader2,
  Plug,
  RefreshCw,
  Search,
  Settings2,
  Sparkles,
  SearchX,
  Trash2,
  CheckCircle2
} from 'lucide-react'
import { CATALOG, CATALOG_ERRORS, type CatalogConnector, type CatalogSkill } from '@shared/catalogo'
import { skillText } from '@shared/catalogo-text'
import type { SkillFolderPreview } from '@shared/ipc-extras'
import { catalogText } from '@shared/mcp-catalog'
import { t as tr, type MsgKey } from '@shared/i18n'
import { Button } from '../../components/Button'
import { confirmDialog } from '../../components/ConfirmDialog'
import { EmptyState } from '../../components/EmptyState'
import { PageHeader } from '../../components/PageHeader'
import { Toggle } from '../../components/Toggle'
import { useT } from '../../lib/i18n'
import { errorMessage } from '../../lib/opencode'
import { useUi, type PersonalizationTab } from '../../stores/ui'
import { getExtras } from '../settings/impl/extras'
import { useMcpConnections } from '../settings/impl/useMcpConnections'
import { ConnectWizard } from './Conectar'
import { ConnectorDetail, SkillDetail, UserSkillDetail } from './Detalle'
import { Ficha, IconTile, Tag } from './Ficha'
import { InstallSkillDialog } from './InstalarHabilidad'
import { connectorState, visibleGroups, type ConnectorState } from './logic'
import { matchesQuery } from './search'
import { useSkills } from './useSkills'

type Detail = { kind: 'skill'; id: string } | { kind: 'userSkill'; name: string } | { kind: 'connector'; id: string }

const TABS: PersonalizationTab[] = ['habilidades', 'conectores', 'tuyos']

function Grid({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <div className="grid gap-3 @xl:grid-cols-2 @4xl:grid-cols-3">{children}</div>
}

function Loading(): React.JSX.Element {
  const t = useT()
  return (
    <div role="status" aria-label={t('pers.loading')} data-testid="pers-loading">
      <p className="mb-3 flex items-center gap-2 text-sm text-muted">
        <Loader2 size={14} className="animate-spin" aria-hidden="true" /> {t('pers.loading')}
      </p>
      <Grid>
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div key={i} aria-hidden="true" className="h-32 animate-pulse rounded-xl border border-border bg-inset" />
        ))}
      </Grid>
    </div>
  )
}

function ErrorState({ title, detail, onRetry }: { title: string; detail?: string; onRetry: () => void }): React.JSX.Element {
  const t = useT()
  return (
    <div role="alert" data-testid="pers-error">
      <EmptyState
        icon={<AlertTriangle size={20} />}
        title={title}
        description={detail ?? t('pers.error.help')}
        action={
          <Button variant="secondary" onClick={onRetry}>
            <RefreshCw size={14} /> {t('pers.retry')}
          </Button>
        }
      />
    </div>
  )
}

export function PersonalizacionView(): React.JSX.Element {
  const t = useT()
  const tab = useUi((s) => s.personalizationTab)
  const setTab = useUi((s) => s.setPersonalizationTab)
  const [query, setQuery] = useState('')
  const skills = useSkills()
  const mcp = useMcpConnections()
  const [detail, setDetail] = useState<Detail | null>(null)
  const [wizard, setWizard] = useState<string | null>(null)
  const [preview, setPreview] = useState<SkillFolderPreview | null>(null)
  const [picking, setPicking] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  const catalogBroken = CATALOG_ERRORS.length > 0
  const loaded = skills.loaded && mcp.loaded
  const bundledOn = useMemo(() => new Map((skills.state?.bundled ?? []).map((b) => [b.id, b.enabled])), [skills.state])
  const present = (s: CatalogSkill): boolean => bundledOn.has(s.id)

  const stateOfItem = (c: CatalogConnector): ConnectorState => connectorState(mcp.serverOf(c.id), mcp.appCfg, mcp.status)
  const existingNames = Object.keys(mcp.appCfg?.servers ?? {})

  const retry = (): void => {
    void skills.refresh()
    void mcp.refresh()
  }

  const addFromFolder = async (): Promise<void> => {
    if (picking) return
    setPicking(true)
    setNotice(null)
    try {
      const p = await skills.pick()
      if (p) setPreview(p)
    } catch (err) {
      setNotice(errorMessage(err))
    } finally {
      setPicking(false)
    }
  }

  const skillMatches = (s: CatalogSkill): boolean => {
    const x = skillText(s)
    return matchesQuery(query, [x.title, x.description, s.publisher, ...x.examples])
  }
  const connectorMatches = (c: CatalogConnector): boolean => {
    const x = catalogText(c)
    return matchesQuery(query, [x.title, x.description, c.publisher, tr(`pers.group.${c.group}` as MsgKey), ...x.examples])
  }

  const bundledSkills = CATALOG.skills.filter(present)
  const catalogConnectors = CATALOG.connectors
  const yourConnectors = Object.keys(mcp.appCfg?.servers ?? {})
  const yourCount = (skills.state?.user.length ?? 0) + bundledSkills.filter((s) => bundledOn.get(s.id)).length + yourConnectors.length

  // ─────────── pestañas ───────────
  const habilidades = (): React.JSX.Element => {
    const list = bundledSkills.filter(skillMatches)
    if (bundledSkills.length === 0)
      return <EmptyState icon={<Sparkles size={20} />} title={t('pers.skills.none')} description={t('pers.skills.noneHelp')} />
    if (list.length === 0) return <NoResults query={query} onClear={() => setQuery('')} />
    return (
      <>
        <p className="mb-3 text-sm text-muted">{t('pers.skills.intro')}</p>
        <Grid>
          {list.map((s) => {
            const x = skillText(s)
            const on = bundledOn.get(s.id) !== false
            return (
              <Ficha
                key={s.id}
                testId={`pers-skill-${s.id}`}
                icon={s.icon}
                title={x.title}
                description={x.description}
                publisher={s.publisher}
                reviewed={s.reviewed}
                onOpen={() => setDetail({ kind: 'skill', id: s.id })}
                tag={on ? <Tag tone="ok">{t('pers.tag.included')}</Tag> : <Tag tone="muted">{t('pers.tag.off')}</Tag>}
              />
            )
          })}
        </Grid>
      </>
    )
  }

  const conectores = (): React.JSX.Element => {
    const list = catalogConnectors.filter(connectorMatches)
    if (catalogConnectors.length === 0)
      return <EmptyState icon={<Plug size={20} />} title={t('pers.connectors.none')} description={t('pers.connectors.noneHelp')} />
    if (list.length === 0) return <NoResults query={query} onClear={() => setQuery('')} />
    const groups = visibleGroups(CATALOG.groups, list)
    return (
      <>
        <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
          <span>{t('pers.connectors.intro')}</span>
          <button
            type="button"
            onClick={() => useUi.getState().openSettingsAt('mcp')}
            className="inline-flex items-center gap-1 text-accent hover:underline"
          >
            <Settings2 size={13} aria-hidden="true" /> {t('pers.connectors.advanced')}
          </button>
        </div>
        {groups.map(({ group, items }) => (
          <section key={group.id} aria-labelledby={`pers-g-${group.id}`} className="mb-6">
            <h2 id={`pers-g-${group.id}`} className="mb-2.5 text-sm font-semibold">
              {t(`pers.group.${group.id}` as MsgKey)}
            </h2>
            <Grid>
              {items.map((c) => {
                const x = catalogText(c)
                const st = stateOfItem(c)
                return (
                  <Ficha
                    key={c.id}
                    testId={`pers-conn-${c.id}`}
                    icon={c.icon}
                    title={x.title}
                    description={x.description}
                    publisher={c.publisher}
                    reviewed={c.reviewed}
                    hint={
                      st === 'needs-login'
                        ? t('pers.hint.needsLogin')
                        : st === 'problem'
                          ? t('pers.hint.problem')
                          : st === 'off'
                            ? t('pers.hint.off')
                            : undefined
                    }
                    onOpen={() => setDetail({ kind: 'connector', id: c.id })}
                    tag={
                      <Tag tone={st === 'connected' ? 'ok' : 'muted'} dot>
                        {st === 'connected' ? t('pers.tag.connected') : t('pers.tag.notConnected')}
                      </Tag>
                    }
                  />
                )
              })}
            </Grid>
          </section>
        ))}
      </>
    )
  }

  const tuyos = (): React.JSX.Element => {
    const userSkills = (skills.state?.user ?? []).filter((u) => matchesQuery(query, [u.name, u.description]))
    const incl = bundledSkills.filter(skillMatches)
    const conns = yourConnectors.filter((name) => {
      const id = mcp.catalog?.installed[name]?.catalogId
      const item = id ? CATALOG.connectors.find((c) => c.id === id) : undefined
      return matchesQuery(query, [name, item ? catalogText(item).title : undefined])
    })
    if (yourCount === 0) {
      return (
        <EmptyState
          icon={<CheckCircle2 size={20} />}
          title={t('pers.yours.empty')}
          description={t('pers.yours.emptyHelp')}
          action={
            <Button variant="secondary" onClick={() => setTab('habilidades')}>
              {t('pers.yours.browse')}
            </Button>
          }
        />
      )
    }
    if (userSkills.length + incl.length + conns.length === 0) return <NoResults query={query} onClear={() => setQuery('')} />
    return (
      <div className="space-y-6">
        <p className="text-sm text-muted">{t('pers.yours.note')}</p>
        {(userSkills.length > 0 || incl.length > 0) && (
          <section aria-labelledby="pers-y-skills">
            <h2 id="pers-y-skills" className="mb-2 flex items-center gap-2 text-sm font-semibold">
              {t('pers.tab.skills')}{' '}
              <span className="rounded-full bg-hover px-2 text-meta text-muted">{userSkills.length + incl.length}</span>
            </h2>
            <ul className="space-y-2">
              {userSkills.map((u) => (
                <Row
                  key={`u-${u.name}`}
                  icon="sparkles"
                  title={u.name}
                  sub={u.description}
                  onOpen={() => setDetail({ kind: 'userSkill', name: u.name })}
                  tag={<Tag tone="accent">{t('pers.tag.installed')}</Tag>}
                  control={
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => void removeUserSkill(u.name)}
                      aria-label={t('pers.skill.removeAria', { name: u.name })}
                    >
                      <Trash2 size={14} /> {t('pers.remove')}
                    </Button>
                  }
                />
              ))}
              {incl.map((s) => {
                const x = skillText(s)
                const on = bundledOn.get(s.id) !== false
                return (
                  <Row
                    key={s.id}
                    icon={s.icon}
                    title={x.title}
                    sub={x.description}
                    onOpen={() => setDetail({ kind: 'skill', id: s.id })}
                    tag={<Tag tone="ok">{t('pers.tag.included')}</Tag>}
                    control={
                      <SwitchCell
                        label={t('pers.skill.toggleAria', { title: x.title })}
                        checked={on}
                        onChange={(v) => void toggleSkill(s.id, v)}
                      />
                    }
                  />
                )
              })}
            </ul>
          </section>
        )}
        {conns.length > 0 && (
          <section aria-labelledby="pers-y-conns">
            <h2 id="pers-y-conns" className="mb-2 flex items-center gap-2 text-sm font-semibold">
              {t('pers.tab.connectors')} <span className="rounded-full bg-hover px-2 text-meta text-muted">{conns.length}</span>
            </h2>
            <ul className="space-y-2">
              {conns.map((name) => {
                const id = mcp.catalog?.installed[name]?.catalogId
                const item = id ? CATALOG.connectors.find((c) => c.id === id) : undefined
                const st = connectorState(name, mcp.appCfg, mcp.status)
                const x = item ? catalogText(item) : null
                return (
                  <Row
                    key={name}
                    icon={item?.icon ?? 'plug'}
                    title={x?.title ?? name}
                    sub={x?.description ?? t('pers.yours.custom')}
                    onOpen={item ? () => setDetail({ kind: 'connector', id: item.id }) : () => useUi.getState().openSettingsAt('mcp')}
                    tag={
                      <Tag tone={st === 'connected' ? 'ok' : 'muted'} dot>
                        {st === 'connected' ? t('pers.tag.connected') : t('pers.tag.notConnected')}
                      </Tag>
                    }
                    control={
                      <SwitchCell
                        label={t('pers.connector.toggleAria', { title: x?.title ?? name })}
                        checked={st === 'connected' || st === 'problem' || st === 'needs-login'}
                        onChange={(v) => void connectorEnable(name, v)}
                      />
                    }
                  />
                )
              })}
            </ul>
          </section>
        )}
        <p className="text-xs text-subtle">{t('pers.yours.footer')}</p>
      </div>
    )
  }

  // ─────────── acciones ───────────
  async function toggleSkill(id: string, enabled: boolean): Promise<void> {
    setNotice(null)
    try {
      await skills.setEnabled(id, enabled)
    } catch (err) {
      setNotice(errorMessage(err))
    }
  }
  async function connectorEnable(name: string, enabled: boolean): Promise<void> {
    setNotice(null)
    try {
      await mcp.setEnabled(name, enabled)
    } catch (err) {
      setNotice(errorMessage(err))
    }
  }
  async function removeUserSkill(name: string): Promise<boolean> {
    // El diálogo de confirmación queda por debajo de un detalle abierto (misma capa, montado antes): se cierra el detalle primero.
    setDetail(null)
    const ok = await confirmDialog({
      title: t('pers.skill.removeTitle', { name }),
      message: t('pers.skill.removeMessage'),
      confirmLabel: t('pers.remove'),
      danger: true
    })
    if (!ok) return false
    setNotice(null)
    try {
      await skills.remove(name)
      setDetail(null)
      return true
    } catch (err) {
      setNotice(errorMessage(err))
      return false
    }
  }
  async function removeConnector(item: CatalogConnector): Promise<void> {
    const name = mcp.serverOf(item.id)
    if (!name) return
    setDetail(null) // ver removeUserSkill
    const ok = await confirmDialog({
      title: t('mcp.remove.title'),
      message: t('mcp.remove.message', { name }),
      confirmLabel: t('mcp.remove.confirm'),
      danger: true
    })
    if (!ok) return
    await mcp.remove(name)
    setDetail(null)
  }

  const detailSkill = detail?.kind === 'skill' ? CATALOG.skills.find((s) => s.id === detail.id) : undefined
  const detailUser = detail?.kind === 'userSkill' ? skills.state?.user.find((u) => u.name === detail.name) : undefined
  const detailConn = detail?.kind === 'connector' ? CATALOG.connectors.find((c) => c.id === detail.id) : undefined
  const wizardItem = wizard ? CATALOG.connectors.find((c) => c.id === wizard) : undefined

  const showAdd = tab !== 'conectores' && !!getExtras()
  const hasBridge = !!getExtras()

  return (
    <div className="flex h-full min-h-0 flex-col bg-bg" data-testid="personalizacion">
      <PageHeader
        title={t('pers.title')}
        meta={<span className="hidden truncate text-xs text-muted min-[900px]:inline">{t('pers.subtitle')}</span>}
        actions={
          <>
            <label className="relative">
              <span className="sr-only">{t('pers.search.label')}</span>
              <Search size={14} className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-subtle" aria-hidden="true" />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t(
                  tab === 'habilidades' ? 'pers.search.skills' : tab === 'conectores' ? 'pers.search.connectors' : 'pers.search.yours'
                )}
                className="no-drag h-8 w-40 rounded-ctl border border-border-strong bg-elevated pr-2 pl-8 text-ui outline-none placeholder:text-subtle focus:border-accent focus:shadow-focus min-[900px]:w-64"
              />
            </label>
            {showAdd && (
              <Button variant="secondary" onClick={() => void addFromFolder()} disabled={picking} data-testid="pers-add-folder">
                {picking ? <Loader2 size={14} className="animate-spin" /> : <FolderPlus size={14} />} {t('pers.addFolder')}
              </Button>
            )}
          </>
        }
      />
      <div
        role="tablist"
        aria-label={t('pers.tabs')}
        className="flex shrink-0 gap-1 border-b border-border px-6 desk:pl-[calc(var(--header-inset,0px)+24px)]"
      >
        {TABS.map((id) => {
          const label = id === 'habilidades' ? t('pers.tab.skills') : id === 'conectores' ? t('pers.tab.connectors') : t('pers.tab.yours')
          const selected = tab === id
          return (
            <button
              key={id}
              type="button"
              role="tab"
              id={`pers-tab-${id}`}
              aria-selected={selected}
              aria-controls="pers-panel"
              tabIndex={selected ? 0 : -1}
              onClick={() => setTab(id)}
              onKeyDown={(e) => {
                if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return
                e.preventDefault()
                const next = TABS[(TABS.indexOf(id) + (e.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length]
                setTab(next)
                requestAnimationFrame(() => document.getElementById(`pers-tab-${next}`)?.focus())
              }}
              className={`no-drag -mb-px flex items-center gap-1.5 border-b-2 px-3 py-2.5 text-ui font-medium outline-none focus-visible:shadow-focus ${selected ? 'border-accent text-fg' : 'border-transparent text-muted hover:text-fg'}`}
            >
              {label}
              {id === 'tuyos' && loaded && yourCount > 0 && (
                <span className="rounded-full bg-accent-soft px-2 text-meta text-accent">{yourCount}</span>
              )}
            </button>
          )
        })}
      </div>
      <div
        id="pers-panel"
        role="tabpanel"
        aria-labelledby={`pers-tab-${tab}`}
        className="@container min-h-0 flex-1 overflow-y-auto px-6 py-5 desk:pl-[calc(var(--header-inset,0px)+24px)]"
      >
        {notice && (
          <p
            role="alert"
            data-testid="pers-notice"
            className="mb-4 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger"
          >
            {notice}
          </p>
        )}
        {!hasBridge ? (
          <EmptyState icon={<Settings2 size={20} />} title={t('pers.nobridge')} />
        ) : catalogBroken ? (
          <ErrorState title={t('pers.error.catalog')} detail={t('pers.error.catalogHelp')} onRetry={retry} />
        ) : !loaded ? (
          <Loading />
        ) : (skills.error && !skills.state) || (mcp.error && tab !== 'habilidades') ? (
          <ErrorState title={t('pers.error.load')} detail={skills.error ?? mcp.error ?? undefined} onRetry={retry} />
        ) : tab === 'habilidades' ? (
          habilidades()
        ) : tab === 'conectores' ? (
          conectores()
        ) : (
          tuyos()
        )}
      </div>

      {detailSkill && (
        <SkillDetail
          item={detailSkill}
          enabled={bundledOn.get(detailSkill.id) !== false}
          onToggle={(v) => skills.setEnabled(detailSkill.id, v)}
          onClose={() => setDetail(null)}
        />
      )}
      {detailUser && (
        <UserSkillDetail
          skill={detailUser}
          onRemove={async () => void (await removeUserSkill(detailUser.name))}
          onClose={() => setDetail(null)}
        />
      )}
      {detailConn && !wizardItem && (
        <ConnectorDetail
          item={detailConn}
          state={stateOfItem(detailConn)}
          onClose={() => setDetail(null)}
          onConnect={() => {
            setDetail(null)
            setWizard(detailConn.id)
          }}
          onLogin={async () => {
            const name = mcp.serverOf(detailConn.id)
            if (name) await mcp.authenticate(name)
          }}
          onSetEnabled={async (v) => {
            const name = mcp.serverOf(detailConn.id)
            if (name) await mcp.setEnabled(name, v)
          }}
          onRemove={() => removeConnector(detailConn)}
        />
      )}
      {wizardItem && (
        <ConnectWizard
          item={wizardItem}
          existingNames={existingNames}
          stateOf={(server) => connectorState(server, mcp.appCfg, mcp.status)}
          onInstall={(req) => mcp.install({ id: wizardItem.id, ...req })}
          onLogin={(server) => mcp.authenticate(server)}
          onClose={() => setWizard(null)}
        />
      )}
      {preview && (
        <InstallSkillDialog
          preview={preview}
          onInstall={async (token) => {
            await skills.install(token)
            setPreview(null)
            setTab('tuyos')
          }}
          onClose={() => setPreview(null)}
        />
      )}
    </div>
  )
}

function NoResults({ query, onClear }: { query: string; onClear: () => void }): React.JSX.Element {
  const t = useT()
  return (
    <div data-testid="pers-empty">
      <EmptyState
        icon={<SearchX size={20} />}
        title={t('pers.search.none', { query })}
        description={t('pers.search.noneHelp')}
        action={
          <Button variant="secondary" onClick={onClear}>
            {t('pers.search.clear')}
          </Button>
        }
      />
    </div>
  )
}

function SwitchCell({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }): React.JSX.Element {
  return <Toggle checked={checked} onChange={onChange} label={label} />
}

function Row({
  icon,
  title,
  sub,
  tag,
  control,
  onOpen
}: {
  icon: CatalogSkill['icon']
  title: string
  sub: string
  tag: React.ReactNode
  control: React.ReactNode
  onOpen: () => void
}): React.JSX.Element {
  return (
    <li className="flex items-center gap-3 rounded-xl border border-border bg-elevated px-3.5 py-3 desk:border-transparent desk:shadow-raised">
      <IconTile icon={icon} size={36} />
      <button type="button" onClick={onOpen} className="min-w-0 flex-1 text-left outline-none focus-visible:shadow-focus">
        <span className="block truncate text-sm font-medium">{title}</span>
        <span className="block truncate text-xs text-muted">{sub}</span>
      </button>
      <span className="hidden shrink-0 sm:inline-flex">{tag}</span>
      <span className="flex shrink-0 items-center gap-1">{control}</span>
    </li>
  )
}
