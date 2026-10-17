import { useState } from 'react'
import { AlertTriangle, ExternalLink, Loader2, Plug, Trash2 } from 'lucide-react'
import { getLang } from '@shared/i18n'
import type { CatalogConnector, CatalogSkill } from '@shared/catalogo'
import { skillText } from '@shared/catalogo-text'
import type { UserSkillInfo } from '@shared/ipc-extras'
import { catalogText } from '@shared/mcp-catalog'
import { Button } from '../../components/Button'
import { Toggle } from '../../components/Toggle'
import { openExternalUrl } from '../../lib/open-external'
import { useLocale, useT } from '../../lib/i18n'
import { errorMessage } from '../../lib/opencode'
import { IconTile, ReviewedSeal, Tag } from './Ficha'
import { Modal } from './Modal'
import { authKey, formatBytes, type ConnectorState } from './logic'

function Section({ title, children }: { title: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <section className="mt-4 first:mt-0">
      <h4 className="text-meta font-semibold tracking-[0.04em] text-subtle uppercase">{title}</h4>
      <div className="mt-1.5 text-sm">{children}</div>
    </section>
  )
}

function Bullets({ items }: { items: string[] }): React.JSX.Element {
  return (
    <ul className="list-disc space-y-1 pl-5">
      {items.map((x) => (
        <li key={x}>{x}</li>
      ))}
    </ul>
  )
}

function Examples({ items }: { items: string[] }): React.JSX.Element {
  return (
    <ul className="space-y-1.5">
      {items.map((x) => (
        <li key={x} className="rounded-lg border border-border bg-bg px-3 py-1.5 text-sm text-muted">
          «{x}»
        </li>
      ))}
    </ul>
  )
}

export function verifiedText(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`)
  if (Number.isNaN(d.getTime())) return iso
  return new Intl.DateTimeFormat(getLang() === 'en' ? 'en-US' : 'es-CL', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC'
  }).format(d)
}

function DetailHeader({
  icon,
  title,
  sub,
  tag,
  seal
}: {
  icon: CatalogSkill['icon']
  title: string
  sub: string
  tag: React.ReactNode
  seal: boolean
}): React.JSX.Element {
  return (
    <div className="flex items-start gap-3">
      <IconTile icon={icon} size={44} />
      <div className="min-w-0">
        <h3 id="pers-detail-title" className="text-base font-semibold desk:text-[17px] desk:leading-6">
          {title}
        </h3>
        <p className="mt-0.5 text-xs text-muted">{sub}</p>
        <div className="mt-1.5 flex flex-wrap items-center gap-2">
          {tag}
          {seal && <ReviewedSeal />}
        </div>
      </div>
    </div>
  )
}

/** Detalle de una habilidad INCLUIDA: qué hace, qué permisos pide, ejemplos y el interruptor. */
export function SkillDetail({
  item,
  enabled,
  onToggle,
  onClose
}: {
  item: CatalogSkill
  enabled: boolean
  onToggle: (enabled: boolean) => Promise<void>
  onClose: () => void
}): React.JSX.Element {
  const t = useT()
  const tx = skillText(item)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const toggle = async (v: boolean): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      await onToggle(v)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal
      labelId="pers-detail-title"
      onClose={onClose}
      header={
        <DetailHeader
          icon={item.icon}
          title={tx.title}
          sub={item.publisher}
          seal={item.reviewed}
          tag={<Tag tone="ok">{t('pers.tag.included')}</Tag>}
        />
      }
      footer={
        <Button variant="primary" onClick={onClose} data-initial-focus="">
          {t('pers.done')}
        </Button>
      }
    >
      <Section title={t('pers.detail.does')}>{tx.description}</Section>
      <Section title={t('pers.detail.asks')}>
        <Bullets items={tx.permissions} />
        <p className="mt-2 text-xs text-muted">{t('pers.skill.askNote')}</p>
      </Section>
      <Section title={t('pers.detail.examples')}>
        <Examples items={tx.examples} />
      </Section>
      <Section title={t('pers.skill.useTitle')}>
        <label className="flex items-center gap-3">
          {busy ? (
            <Loader2 size={16} className="animate-spin text-muted" />
          ) : (
            <Toggle checked={enabled} onChange={(v) => void toggle(v)} label={t('pers.skill.use')} />
          )}
          <span>{enabled ? t('pers.skill.useOn') : t('pers.skill.useOff')}</span>
        </label>
        <p className="mt-1.5 text-xs text-muted">{t('pers.skill.useNote')}</p>
        {error && (
          <p role="alert" className="mt-2 text-xs text-danger">
            {error}
          </p>
        )}
      </Section>
      <p className="mt-4 text-xs text-muted">{t('pers.detail.verifiedAt', { date: verifiedText(item.verifiedAt) })}</p>
    </Modal>
  )
}

/** Detalle de una habilidad que la persona instaló desde una carpeta (nunca lleva el sello de revisión). */
export function UserSkillDetail({
  skill,
  onRemove,
  onClose
}: {
  skill: UserSkillInfo
  onRemove: () => Promise<void>
  onClose: () => void
}): React.JSX.Element {
  const t = useT()
  const locale = useLocale()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const remove = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      await onRemove()
    } catch (err) {
      setError(errorMessage(err))
      setBusy(false)
    }
  }
  return (
    <Modal
      labelId="pers-detail-title"
      onClose={onClose}
      busy={busy}
      header={
        <DetailHeader
          icon="sparkles"
          title={skill.name}
          sub={t('pers.skill.yours')}
          seal={false}
          tag={<Tag tone="accent">{t('pers.tag.installed')}</Tag>}
        />
      }
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy} data-initial-focus="">
            {t('pers.done')}
          </Button>
          <Button variant="danger" onClick={() => void remove()} disabled={busy}>
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />} {t('pers.remove')}
          </Button>
        </>
      }
    >
      <Section title={t('pers.detail.does')}>{skill.description}</Section>
      <Section title={t('pers.detail.asks')}>
        <p>{t('pers.skill.userAsks')}</p>
        {skill.hasScripts && (
          <p className="mt-2 flex items-start gap-1.5 text-xs text-warning">
            <AlertTriangle size={14} className="mt-0.5 shrink-0" /> {t('pers.skill.hasScripts')}
          </p>
        )}
        {skill.modified && (
          <p className="mt-2 flex items-start gap-1.5 text-xs text-warning">
            <AlertTriangle size={14} className="mt-0.5 shrink-0" /> {t('pers.skill.modified')}
          </p>
        )}
      </Section>
      <Section title={t('pers.skill.contents')}>
        {t('pers.skill.files', { count: skill.fileCount })} · {formatBytes(skill.bytes, locale)}
      </Section>
      <p className="mt-4 text-xs text-muted">{t('pers.skill.notReviewed')}</p>
      {error && (
        <p role="alert" className="mt-2 text-xs text-danger">
          {error}
        </p>
      )}
    </Modal>
  )
}

/** Detalle de un conector: qué podrá y qué NO podrá hacer, qué pide, ejemplos y (si ya está añadido) apagar o quitar. */
export function ConnectorDetail({
  item,
  state,
  onClose,
  onConnect,
  onLogin,
  onSetEnabled,
  onRemove
}: {
  item: CatalogConnector
  state: ConnectorState
  onClose: () => void
  onConnect: () => void
  onLogin: () => Promise<void>
  onSetEnabled: (enabled: boolean) => Promise<void>
  onRemove: () => Promise<void>
}): React.JSX.Element {
  const t = useT()
  const ct = catalogText(item)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const host = new URL(item.url).host
  const added = state !== 'none'
  const run = async (fn: () => Promise<void>, keepBusy = false): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      await fn()
      if (!keepBusy) setBusy(false)
    } catch (err) {
      setError(errorMessage(err))
      setBusy(false)
    }
  }
  return (
    <Modal
      labelId="pers-detail-title"
      onClose={onClose}
      busy={busy}
      wide
      header={
        <DetailHeader
          icon={item.icon}
          title={ct.title}
          sub={item.publisher}
          seal={item.reviewed}
          tag={
            <Tag tone={state === 'connected' ? 'ok' : 'muted'} dot>
              {state === 'connected' ? t('pers.tag.connected') : t('pers.tag.notConnected')}
            </Tag>
          }
        />
      }
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy} data-initial-focus="">
            {t('pers.close')}
          </Button>
          {added && (
            <Button
              variant="danger"
              disabled={busy}
              onClick={() => void run(onRemove, true)}
              aria-label={t('pers.connector.removeAria', { title: ct.title })}
            >
              <Trash2 size={14} /> {t('pers.remove')}
            </Button>
          )}
          {state === 'needs-login' && (
            <Button variant="primary" disabled={busy} onClick={() => void run(onLogin)}>
              {busy ? <Loader2 size={14} className="animate-spin" /> : <ExternalLink size={14} />} {t('pers.connector.login')}
            </Button>
          )}
          {state === 'none' && (
            <Button variant="primary" onClick={onConnect}>
              <Plug size={14} /> {t('pers.connect')}
            </Button>
          )}
        </>
      }
    >
      <p className="text-sm">{ct.description}</p>
      <div className="mt-4 grid gap-4 desk:grid-cols-2">
        <Section title={t('pers.detail.can')}>
          <Bullets items={ct.capabilities} />
        </Section>
        <Section title={t('pers.detail.cannot')}>
          <Bullets items={ct.cannot} />
        </Section>
      </div>
      <Section title={t('pers.detail.asks')}>
        <ul className="list-disc space-y-1 pl-5">
          <li>{t(authKey(item))}</li>
          <li>{item.writes ? t('pers.perm.writes') : t('pers.perm.readOnly')}</li>
          <li>{t('pers.perm.host', { host })}</li>
          <li>{t('pers.perm.askEach')}</li>
        </ul>
        <p className="mt-2 flex items-start gap-1.5 text-xs text-warning">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" /> {ct.dataLeaves}
        </p>
      </Section>
      <Section title={t('pers.detail.examples')}>
        <Examples items={ct.examples} />
      </Section>
      {added && state !== 'needs-login' && (
        <Section title={t('pers.connector.useTitle')}>
          <label className="flex items-center gap-3">
            <Toggle
              checked={state === 'connected' || state === 'problem'}
              disabled={busy}
              label={t('pers.connector.use')}
              onChange={(v) => void run(() => onSetEnabled(v))}
            />
            <span>{state === 'off' ? t('pers.connector.useOff') : t('pers.connector.useOn')}</span>
          </label>
          {state === 'problem' && <p className="mt-1.5 text-xs text-danger">{t('pers.connector.problem')}</p>}
        </Section>
      )}
      <p className="mt-4 flex flex-wrap items-center gap-x-3 text-xs text-muted">
        <span>{t('pers.detail.verifiedAt', { date: verifiedText(item.verifiedAt) })}</span>
        <button
          type="button"
          onClick={() => void openExternalUrl(item.docsUrl)}
          className="inline-flex items-center gap-1 text-accent hover:underline"
        >
          {t('pers.detail.docs')} <ExternalLink size={11} />
        </button>
      </p>
      {error && (
        <p role="alert" className="mt-2 text-xs text-danger">
          {error}
        </p>
      )}
    </Modal>
  )
}
