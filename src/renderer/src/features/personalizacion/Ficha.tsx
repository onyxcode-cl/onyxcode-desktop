import { Check, Circle, ShieldCheck } from 'lucide-react'
import type { CatalogIcon } from '@shared/catalogo'
import { useT } from '../../lib/i18n'
import { ICONS } from './icons'

export type TagTone = 'ok' | 'muted' | 'warn' | 'accent'

const TAG_TONES: Record<TagTone, string> = {
  ok: 'border-success/40 bg-success/10 text-success',
  muted: 'border-border bg-hover text-muted',
  warn: 'border-warning/40 bg-warning/10 text-warning',
  accent: 'border-accent/40 bg-accent-soft text-accent'
}

/** Etiqueta de estado: lleva ícono además del color (no se distingue solo por color). */
export function Tag({ tone, children, dot }: { tone: TagTone; children: React.ReactNode; dot?: boolean }): React.JSX.Element {
  return (
    <span className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-0.5 text-meta font-medium ${TAG_TONES[tone]}`}>
      {tone === 'ok' ? (
        <Check size={12} aria-hidden="true" />
      ) : dot ? (
        <Circle size={8} className="fill-current" aria-hidden="true" />
      ) : null}
      {children}
    </span>
  )
}

/** Sello «Revisado por Lazunox»: solo para fichas del catálogo empaquetado (las revisa el dueño), nunca para lo que instala la persona. */
export function ReviewedSeal(): React.JSX.Element {
  const t = useT()
  return (
    <span className="inline-flex items-center gap-1 text-meta text-muted">
      <ShieldCheck size={13} className="text-success" aria-hidden="true" /> {t('pers.reviewed')}
    </span>
  )
}

export function IconTile({ icon, size = 40 }: { icon: CatalogIcon; size?: number }): React.JSX.Element {
  const Icon = ICONS[icon]
  return (
    <span
      aria-hidden="true"
      style={{ width: size, height: size }}
      className="grid shrink-0 place-items-center rounded-xl bg-accent-soft text-accent"
    >
      <Icon size={Math.round(size * 0.5)} strokeWidth={1.8} />
    </span>
  )
}

/** Tarjeta de una ficha: ícono, título (abre el detalle), descripción corta, quién la publica y su estado. */
export function Ficha({
  icon,
  title,
  description,
  publisher,
  reviewed,
  tag,
  hint,
  onOpen,
  testId
}: {
  icon: CatalogIcon
  title: string
  description: string
  publisher: string
  reviewed: boolean
  tag: React.ReactNode
  /** Línea extra bajo la descripción (p. ej. «Falta entrar a tu cuenta»). */
  hint?: string
  onOpen: () => void
  testId?: string
}): React.JSX.Element {
  return (
    <article
      data-testid={testId}
      className="relative flex flex-col gap-3 rounded-xl border border-border bg-elevated p-4 transition-colors hover:border-border-strong desk:border-transparent desk:shadow-raised"
    >
      <div className="flex items-start gap-3">
        <IconTile icon={icon} />
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold desk:text-ui">
            {/* Todo el área de la tarjeta abre el detalle: el botón se estira sobre ella. */}
            <button
              type="button"
              onClick={onOpen}
              className="text-left outline-none after:absolute after:inset-0 after:rounded-xl focus-visible:after:shadow-[0_0_0_3px_var(--accent-ring)]"
            >
              {title}
            </button>
          </h3>
          <p className="mt-1 text-xs leading-relaxed text-muted desk:text-meta">{description}</p>
          {hint && <p className="mt-1 text-meta text-warning">{hint}</p>}
        </div>
      </div>
      <div className="mt-auto flex flex-wrap items-center justify-between gap-2">
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="truncate text-meta text-subtle">{publisher}</span>
          {reviewed && <ReviewedSeal />}
        </span>
        {tag}
      </div>
    </article>
  )
}
