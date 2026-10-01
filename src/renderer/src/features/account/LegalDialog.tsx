import { useEffect, useRef } from 'react'
import { X } from 'lucide-react'
import { LEGAL_DRAFT_NOTICE, type LegalDoc } from '@shared/account-legal'
import { useT } from '../../lib/i18n'
import { IconButton } from '../../components/IconButton'

/** Muestra el texto del borrador local cuando aún no hay URL publicada. */
export function LegalDialog({ doc, onClose }: { doc: LegalDoc; onClose: () => void }): React.JSX.Element {
  const t = useT()
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    ref.current?.focus()
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        onClose()
      }
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [onClose])
  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-fg/30 p-6 animate-fade-in" onMouseDown={onClose}>
      <div
        ref={ref}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="legal-title"
        onMouseDown={(e) => e.stopPropagation()}
        className="flex max-h-full w-full max-w-lg flex-col rounded-2xl border border-border bg-elevated shadow-2xl outline-none"
      >
        <header className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
          <div>
            <h3 id="legal-title" className="text-base font-semibold">
              {doc.title}
            </h3>
            <p className="mt-1 text-xs text-warning">{LEGAL_DRAFT_NOTICE}</p>
          </div>
          <IconButton label={t('account.legal.close')} onClick={onClose}>
            <X size={16} />
          </IconButton>
        </header>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4 text-sm leading-relaxed">
          {doc.sections.map((s) => (
            <section key={s.heading}>
              <h4 className="font-medium">{s.heading}</h4>
              {s.body.map((p) => (
                <p key={p} className="mt-1 text-muted">
                  {p}
                </p>
              ))}
            </section>
          ))}
        </div>
      </div>
    </div>
  )
}
