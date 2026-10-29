/**
 * Menú «⋯» de la barra de Code: reúne todo lo que no son los paneles. Ficha del proyecto (nombre, carpeta, acceso de la IA y Bóveda),
 * vista del trabajo (Resumida / Con pasos / Detallada), memoria, exportar, bifurcar y compactar. Los paneles van aparte, en la cápsula
 * de iconos de la barra.
 */
import { useCallback, useRef, useState } from 'react'
import {
  BrainCircuit,
  Check,
  ClipboardCopy,
  FileDown,
  FileText,
  GitFork,
  IdCard,
  MoreHorizontal,
  SlidersHorizontal,
  Sparkles
} from 'lucide-react'
import { useT } from '../../../lib/i18n'
import { openExportOptions, type ExportAction } from '../../../components/ExportConversation'
import { PortalMenu, PortalMenuItem, PortalMenuSeparator } from '../../../components/PortalMenu'
import { READING_MODES, useReadingMode, useWorkView, type ReadingMode } from '../../../lib/reading-mode'
import { useUi } from '../../../stores/ui'
import { ProjectDialog } from '../../project-profile/ProjectDialog'

export function ToolbarMore({
  directory,
  hasSession,
  busy,
  onExport,
  onFork,
  onCompact
}: {
  directory: string
  hasSession: boolean
  busy: boolean
  onExport: (action: ExportAction) => void
  onFork: () => void
  onCompact: () => void
}): React.JSX.Element {
  const t = useT()
  const [open, setOpen] = useState(false)
  const [ficha, setFicha] = useState(false)
  const anchor = useRef<HTMLDivElement>(null)
  const close = useCallback(() => setOpen(false), [])
  const mode = useWorkView('code')
  const run = (fn: () => void) => (): void => {
    setOpen(false)
    fn()
  }
  const ic = { size: 14, strokeWidth: 1.75 } as const
  return (
    <div ref={anchor} className="no-drag relative flex shrink-0" data-testid="toolbar-more">
      <button
        type="button"
        title={t('code.toolbar.more')}
        aria-label={t('code.toolbar.more')}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={`flex size-8 items-center justify-center rounded-lg hover:bg-hover hover:text-fg ${open ? 'bg-active text-fg' : 'text-muted'}`}
      >
        <MoreHorizontal size={17} strokeWidth={1.75} />
      </button>
      <PortalMenu open={open} anchor={anchor} onClose={close} label={t('code.toolbar.more')}>
        <PortalMenuItem icon={<IdCard {...ic} />} label={t('project.card.title')} onClick={run(() => setFicha(true))} />
        <PortalMenuSeparator />
        {READING_MODES.map((id: ReadingMode) => (
          <PortalMenuItem
            key={id}
            icon={mode === id ? <Check {...ic} /> : <span className="inline-block w-3.5" />}
            label={t(`code.reading.${id}` as const)}
            onClick={run(() => useReadingMode.getState().setView('code', id))}
          />
        ))}
        <PortalMenuSeparator />
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
      {ficha && <ProjectDialog folder={directory} full={false} onClose={() => setFicha(false)} />}
    </div>
  )
}
