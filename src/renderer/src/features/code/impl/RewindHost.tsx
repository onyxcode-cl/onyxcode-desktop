/**
 * Conexión del diálogo «Volver a antes de este turno» y del aviso posterior con el store de Code. `MessageStream` solo monta estos
 * dos componentes (así el archivo del flujo de mensajes casi no cambia).
 */
import { useEffect } from 'react'
import { t } from '@shared/i18n'
import { confirmDialog } from '../../../components/ConfirmDialog'
import { RewindDialog } from './RewindDialog'
import { RewindResultNotice } from './RewindCard'
import { useCode } from './store'

/** Diálogo abierto para ESTA conversación (si lo hay). Si el motor no tiene las rutas, cae al «Revertir» de siempre. */
export function RewindDialogHost({ sessionID }: { sessionID: string }): React.JSX.Element | null {
  const dialog = useCode((s) => s.rewindDialog)
  const rewindReview = useCode((s) => s.rewindReview)
  const rewindTo = useCode((s) => s.rewindTo)
  const closeRewind = useCode((s) => s.closeRewind)
  const markUnavailable = useCode((s) => s.markRewindUnavailable)
  const revertTo = useCode((s) => s.revertTo)
  if (!dialog || dialog.sessionID !== sessionID) return null
  const { messageID } = dialog
  return (
    <RewindDialog
      key={messageID}
      loadReview={() => rewindReview(sessionID, messageID)}
      onConfirm={(modo, overwrite) => rewindTo(sessionID, messageID, modo, overwrite)}
      onClose={closeRewind}
      onFallback={() => {
        // 404: el motor no tiene (o apagó) estas rutas. Se recuerda y se sigue con el flujo de siempre.
        markUnavailable(sessionID)
        void confirmDialog({
          title: t('code.msg.revertTitle'),
          message: t('code.msg.revertBody'),
          confirmLabel: t('code.msg.revert'),
          danger: true
        }).then((ok) => (ok ? revertTo(messageID) : undefined))
      }}
    />
  )
}

/** Aviso de «volviste atrás» con «Deshacer». Se va solo cuando la conversación vuelve a trabajar (ya no se puede deshacer limpio). */
export function RewindNoticeHost({ sessionID, busy }: { sessionID: string; busy: boolean }): React.JSX.Element | null {
  const notice = useCode((s) => s.rewindNotices[sessionID])
  const unrevert = useCode((s) => s.unrevert)
  const dismiss = useCode((s) => s.dismissRewindNotice)
  useEffect(() => {
    if (busy && notice) dismiss(sessionID)
  }, [busy, notice, dismiss, sessionID])
  if (!notice) return null
  return (
    <RewindResultNotice
      notice={notice}
      busy={busy}
      // `unrevert` elige la ruta nueva y, si el motor no tiene nada que deshacer por ahí, la de siempre.
      onUndo={() => unrevert()}
      onDismiss={() => dismiss(sessionID)}
    />
  )
}
