/**
 * Confirmación para instalar una habilidad propia desde una carpeta (F8-B181). La carpeta ya la validó `main` (estructura, tamaño,
 * sin enlaces ni binarios, sin claves); aquí se muestra lo que se copiaría, con aviso claro de que una habilidad es código de
 * terceros para el agente. Nada se copia hasta «Instalar», y solo si marcas la casilla.
 */
import { useState } from 'react'
import { AlertTriangle, FileCode, FileText, Loader2 } from 'lucide-react'
import type { SkillFolderPreview } from '@shared/ipc-extras'
import { Button } from '../../components/Button'
import { useLocale, useT } from '../../lib/i18n'
import { errorMessage } from '../../lib/opencode'
import { IconTile } from './Ficha'
import { Modal } from './Modal'
import { formatBytes } from './logic'

export function InstallSkillDialog({
  preview,
  onInstall,
  onClose
}: {
  preview: SkillFolderPreview
  onInstall: (token: string) => Promise<void>
  onClose: () => void
}): React.JSX.Element {
  const t = useT()
  const locale = useLocale()
  const [understood, setUnderstood] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const hasScripts = preview.scripts.length > 0

  const install = async (): Promise<void> => {
    if (!understood || busy) return
    setBusy(true)
    setError(null)
    try {
      await onInstall(preview.token)
    } catch (err) {
      setError(errorMessage(err))
      setBusy(false)
    }
  }

  return (
    <Modal
      labelId="pers-install-title"
      onClose={onClose}
      busy={busy}
      wide
      header={
        <div className="flex items-start gap-3">
          <IconTile icon="sparkles" size={44} />
          <div className="min-w-0">
            <h3 id="pers-install-title" className="text-base font-semibold desk:text-[17px] desk:leading-6">
              {t('pers.install.title', { name: preview.name })}
            </h3>
            <p className="mt-0.5 text-xs text-muted">
              {t('pers.install.from', { folder: preview.folderLabel })} · {t('pers.skill.files', { count: preview.fileCount })} ·{' '}
              {formatBytes(preview.bytes, locale)}
            </p>
          </div>
        </div>
      }
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy} data-initial-focus="">
            {t('pers.cancel')}
          </Button>
          <Button variant="primary" disabled={!understood || busy} onClick={() => void install()}>
            {busy && <Loader2 size={14} className="animate-spin" />} {t('pers.install.confirm')}
          </Button>
        </>
      }
    >
      <div className="rounded-xl border border-warning/40 bg-warning/10 p-3.5 text-sm">
        <p className="flex items-center gap-1.5 font-semibold text-warning">
          <AlertTriangle size={15} aria-hidden="true" /> {t('pers.install.warnTitle')}
        </p>
        <p className="mt-1.5 leading-relaxed">{t('pers.install.warnBody')}</p>
      </div>

      <h4 className="mt-4 text-meta font-semibold tracking-[0.04em] text-subtle uppercase">{t('pers.detail.does')}</h4>
      <p className="mt-1.5 text-sm">{preview.description}</p>

      {hasScripts && (
        <div className="mt-4">
          <h4 className="text-meta font-semibold tracking-[0.04em] text-warning uppercase">{t('pers.install.scripts')}</h4>
          <p className="mt-1 text-xs text-muted">{t('pers.install.scriptsNote')}</p>
          <ul className="mt-1.5 space-y-1 font-mono text-xs">
            {preview.scripts.map((s) => (
              <li key={s} className="flex items-center gap-1.5">
                <FileCode size={13} className="shrink-0 text-warning" aria-hidden="true" /> {s}
              </li>
            ))}
          </ul>
        </div>
      )}

      <h4 className="mt-4 text-meta font-semibold tracking-[0.04em] text-subtle uppercase">{t('pers.install.instructions')}</h4>
      <pre
        tabIndex={0}
        aria-label={t('pers.install.instructionsAria')}
        className="mt-1.5 max-h-56 overflow-auto rounded-lg border border-border bg-bg p-3 font-mono text-meta leading-relaxed whitespace-pre-wrap"
      >
        {preview.bodyPreview}
        {preview.bodyTruncated ? `\n\n… ${t('pers.install.truncated')}` : ''}
      </pre>

      <details className="mt-3 text-xs text-muted">
        <summary className="cursor-pointer">{t('pers.install.fileList', { count: preview.fileCount })}</summary>
        <ul className="mt-1.5 max-h-40 space-y-0.5 overflow-auto font-mono">
          {preview.files.map((f) => (
            <li key={f.path} className="flex items-center gap-1.5">
              {f.script ? <FileCode size={12} aria-hidden="true" /> : <FileText size={12} aria-hidden="true" />} {f.path}
              <span className="ml-auto pl-3 text-subtle">{formatBytes(f.bytes, locale)}</span>
            </li>
          ))}
        </ul>
      </details>

      <label className="mt-4 flex items-start gap-2.5 text-sm">
        <input
          type="checkbox"
          checked={understood}
          onChange={(e) => setUnderstood(e.target.checked)}
          disabled={busy}
          className="mt-1 size-4 shrink-0 accent-[var(--accent)]"
        />
        <span>{t('pers.install.understand')}</span>
      </label>
      <p className="mt-2 text-xs text-muted">{t('pers.install.noRun')}</p>
      {error && (
        <p role="alert" className="mt-2 text-sm text-danger">
          {error}
        </p>
      )}
    </Modal>
  )
}
