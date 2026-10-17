/**
 * Menú «…» de la barra de Code: reúne las acciones secundarias (memoria, exportar, bifurcar, compactar) con su ETIQUETA cuando
 * la barra es estrecha y no caben como iconos sueltos (H13). Con la barra ancha no se ve: los mismos iconos salen sueltos, cada uno
 * con `aria-label` y tooltip. Se decide por consulta de contenedor (`@max-[44rem]`), no por el ancho de la ventana.
 */
import { useCallback, useRef, useState } from 'react'
import { BrainCircuit, ClipboardCopy, FileDown, FileText, GitFork, MoreHorizontal, SlidersHorizontal, Sparkles } from 'lucide-react'
import { useT } from '../../../lib/i18n'
import { openExportOptions, type ExportAction } from '../../../components/ExportConversation'
import { PortalMenu, PortalMenuItem, PortalMenuSeparator } from '../../../components/PortalMenu'
import { useUi } from '../../../stores/ui'

/** Punto de quiebre (ancho de la barra) por debajo del cual las acciones secundarias pasan al menú «…». */
export const TOOLBAR_COLLAPSE = '44rem'

export function ToolbarMore({
  hasSession,
  busy,
  onExport,
  onFork,
  onCompact
}: {
  hasSession: boolean
  busy: boolean
  onExport: (action: ExportAction) => void
  onFork: () => void
  onCompact: () => void
}): React.JSX.Element {
  const t = useT()
  const [open, setOpen] = useState(false)
  const anchor = useRef<HTMLDivElement>(null)
  const close = useCallback(() => setOpen(false), [])
  const run = (fn: () => void) => (): void => {
    setOpen(false)
    fn()
  }
  const ic = { size: 14, strokeWidth: 1.75 } as const
  return (
    <div ref={anchor} className="no-drag relative hidden shrink-0 desk:@max-[44rem]:flex" data-testid="toolbar-more">
      <button
        type="button"
        title={t('code.toolbar.more')}
        aria-label={t('code.toolbar.more')}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={`flex size-7 items-center justify-center rounded-ctl-sm hover:bg-hover hover:text-fg ${open ? 'bg-active text-fg' : 'text-muted'}`}
      >
        <MoreHorizontal size={16} strokeWidth={1.75} />
      </button>
      <PortalMenu open={open} anchor={anchor} onClose={close} label={t('code.toolbar.more')}>
        <PortalMenuItem
          icon={<BrainCircuit {...ic} />}
          label={t('instr.open')}
          onClick={run(() => useUi.getState().openSettingsAt('instructions'))}
        />
        {hasSession && (
          <>
            <PortalMenuSeparator />
            <PortalMenuItem icon={<ClipboardCopy {...ic} />} label={t('conv.export.copy')} onClick={run(() => onExport('copy'))} />
            <PortalMenuItem icon={<FileText {...ic} />} label={t('conv.export.saveMd')} onClick={run(() => onExport('md'))} />
            <PortalMenuItem icon={<FileDown {...ic} />} label={t('conv.export.savePdf')} onClick={run(() => onExport('pdf'))} />
            <PortalMenuItem icon={<SlidersHorizontal {...ic} />} label={t('conv.export.options')} onClick={run(openExportOptions)} />
            <PortalMenuSeparator />
            <PortalMenuItem icon={<GitFork {...ic} />} label={t('code.toolbar.fork')} disabled={busy} onClick={run(onFork)} />
            <PortalMenuItem icon={<Sparkles {...ic} />} label={t('code.toolbar.compact')} disabled={busy} onClick={run(onCompact)} />
          </>
        )}
      </PortalMenu>
    </div>
  )
}
