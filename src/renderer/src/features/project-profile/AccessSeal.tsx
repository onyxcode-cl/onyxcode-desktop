/** Sello del nivel de acceso de la IA: azul = aislado, ámbar = con comandos aprobados, rojo = control total. Lo único «propio» de la Ficha. */
import { Bolt, Lock, ShieldHalf } from 'lucide-react'
import type { AccessLevel } from '@shared/project-profile'
import { useT } from '../../lib/i18n'

export const LEVEL_TONE: Record<AccessLevel, { chip: string; bar: string; icon: string }> = {
  aislado: { chip: 'border-accent/40 bg-accent-soft text-accent', bar: 'bg-accent', icon: 'text-accent' },
  comandos: { chip: 'border-warning/40 bg-warning/10 text-warning', bar: 'bg-warning', icon: 'text-warning' },
  total: { chip: 'border-danger/40 bg-danger/10 text-danger', bar: 'bg-danger', icon: 'text-danger' }
}

export const LEVEL_ICON = { aislado: Lock, comandos: ShieldHalf, total: Bolt } as const

export function AccessSeal({
  level,
  short = false,
  onClick
}: {
  level: AccessLevel
  short?: boolean
  onClick?: () => void
}): React.JSX.Element {
  const t = useT()
  const Icon = LEVEL_ICON[level]
  const label = t(short ? `project.level.short.${level}` : `project.level.${level}`)
  const cls = `inline-flex h-6 shrink-0 items-center gap-1.5 rounded-full border px-2.5 text-meta font-medium whitespace-nowrap ${LEVEL_TONE[level].chip}`
  return onClick ? (
    <button type="button" className={`no-drag ${cls} hover:brightness-110`} onClick={onClick} title={t('project.card.edit')}>
      <Icon size={12} aria-hidden />
      {label}
    </button>
  ) : (
    <span className={cls}>
      <Icon size={12} aria-hidden />
      {label}
    </span>
  )
}

/** Barra de tres tramos: se llena hasta el nivel actual con su color. */
export function AccessBar({ level }: { level: AccessLevel }): React.JSX.Element {
  const n = level === 'aislado' ? 1 : level === 'comandos' ? 2 : 3
  const tones = ['bg-accent', level === 'total' ? 'bg-danger' : 'bg-warning', 'bg-danger']
  return (
    <div className="flex gap-1" aria-hidden>
      {[0, 1, 2].map((i) => (
        <span key={i} className={`h-[5px] flex-1 rounded-full ${i < n ? tones[i] : 'bg-border'}`} />
      ))}
    </div>
  )
}
