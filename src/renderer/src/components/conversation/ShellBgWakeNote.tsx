import { useState } from 'react'
import { ChevronRight, Terminal } from 'lucide-react'
import { t } from '@shared/i18n'
import type { ShellBgWakeInfo } from '@shared/shell-bg-wake-marker'
import { useLang } from '../../lib/i18n'

const TITLE_KEY = {
  exit: 'conv.shellBgWake.exit',
  'possibly-stuck': 'conv.shellBgWake.stuck',
  batch: 'conv.shellBgWake.batch'
} as const

/**
 * Aviso automático de `bgshell` (un trabajo en segundo plano terminó): una línea discreta con el detalle plegable, en vez de una
 * burbuja de la persona con todo el texto que lee el modelo (F8-B207). Lo usan Chat, Code y Tareas.
 */
export function ShellBgWakeNote({ info }: { info: ShellBgWakeInfo }): React.JSX.Element {
  useLang((s) => s.lang) // re-pinta al cambiar de idioma
  const [open, setOpen] = useState(false)
  return (
    <div className="my-0.5 text-[13px]" data-testid="shell-bg-wake-note">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="-ml-1 flex items-center gap-1.5 rounded-md px-1 py-0.5 text-muted transition-colors hover:bg-hover hover:text-fg"
      >
        <Terminal size={13} aria-hidden="true" />
        <span>{t(TITLE_KEY[info.kind], { count: info.count })}</span>
        <ChevronRight size={13} aria-hidden="true" className={`transition-transform duration-200 ${open ? 'rotate-90' : ''}`} />
      </button>
      {open && (
        <div className="mt-1.5 ml-1.5 animate-fade-in border-l-2 border-border pl-3 text-muted">
          <p className="mb-1 text-[12px] text-subtle">{t('conv.shellBgWake.auto')}</p>
          <pre className="max-h-80 overflow-y-auto font-mono text-[12px] leading-5 break-words whitespace-pre-wrap">{info.text}</pre>
        </div>
      )}
    </div>
  )
}
