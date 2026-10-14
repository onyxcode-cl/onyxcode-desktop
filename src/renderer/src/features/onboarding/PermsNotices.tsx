/**
 * Avisos de los permisos de macOS que comparten la bienvenida, el asistente y la tarjeta de Ajustes: reiniciar para Grabación de
 * pantalla, app fuera de Aplicaciones y la ayuda «Los permisos no se activan». Nada se ejecuta: los comandos solo se copian.
 */
import { useState } from 'react'
import { AlertTriangle, Check, Copy, RotateCw } from 'lucide-react'
import { DISPLAY_NAME } from '@shared/brand'
import { tccResetCommands, tccResetText, type AppLocation } from '@shared/mac-permissions'
import { Button } from '../../components/Button'
import { call } from '../../lib/api'
import { useT } from '../../lib/i18n'

/** «Mueve Lazunox a Aplicaciones…» cuando corre translocada o desde el .dmg. */
export function AppLocationNotice({ location }: { location: AppLocation | null | undefined }): React.JSX.Element | null {
  const t = useT()
  if (!location) return null
  return (
    <div
      role="alert"
      className="mt-3 flex items-start gap-2 rounded-ctl bg-inset px-3.5 py-3 text-left text-[13px] leading-[18px] text-muted"
    >
      <AlertTriangle size={16} className="mt-0.5 shrink-0 text-warning" />
      <p>{t(location === 'translocated' ? 'wizard.perms.location.translocated' : 'wizard.perms.location.volume', { app: DISPLAY_NAME })}</p>
    </div>
  )
}

/** Accesibilidad concedida y Pantalla no: explica el reinicio de inmediato y lo ofrece. */
export function ScreenRestartNotice(): React.JSX.Element {
  const t = useT()
  return (
    <div role="status" className="mt-3 rounded-ctl bg-inset px-3.5 py-3 text-left text-[13px] leading-[18px]">
      <p className="font-medium text-fg">{t('wizard.perms.restart.title')}</p>
      <p className="mt-1 text-muted">{t('wizard.perms.restart.body', { app: DISPLAY_NAME })}</p>
      <div className="mt-2">
        <Button variant="primary" onClick={() => void call('app:relaunch')}>
          <RotateCw size={14} /> {t('wizard.perms.restart.button', { app: DISPLAY_NAME })}
        </Button>
      </div>
    </div>
  )
}

/** «Los permisos no se activan»: explica el reinicio y deja copiar (sin ejecutar) los comandos de reparación. */
export function PermsHelp(): React.JSX.Element {
  const t = useT()
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const copy = (): void => {
    void navigator.clipboard
      .writeText(tccResetText())
      .then(() => {
        setCopied(true)
        setTimeout(() => setCopied(false), 2500)
      })
      .catch(() => undefined)
  }
  return (
    <div className="mt-3 text-left text-[13px] leading-[18px]">
      <button
        type="button"
        className="text-accent underline-offset-2 hover:underline"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        {t('wizard.perms.help.toggle')}
      </button>
      {open && (
        <div className="mt-2 space-y-2 rounded-ctl bg-inset px-3.5 py-3 text-muted">
          <p>{t('wizard.perms.help.intro', { app: DISPLAY_NAME })}</p>
          <p>{t('wizard.perms.help.repair', { app: DISPLAY_NAME })}</p>
          <pre className="overflow-x-auto rounded-ctl bg-bg px-2.5 py-2 text-[12px] leading-[17px] text-fg select-text">
            {tccResetCommands().join('\n')}
          </pre>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={copy}>
              {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? t('wizard.perms.help.copied') : t('wizard.perms.help.copy')}
            </Button>
            <Button variant="secondary" onClick={() => void call('app:relaunch')}>
              <RotateCw size={14} /> {t('wizard.perms.help.restart', { app: DISPLAY_NAME })}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
