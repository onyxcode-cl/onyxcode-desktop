/** Aviso «Rutinas y los términos de OpenCode»: diálogo de reconocimiento y ajuste persistente. */
import {
  needsRoutinesConsent,
  ROUTINES_TERMS_BODY,
  ROUTINES_TERMS_CANCEL,
  ROUTINES_TERMS_CONFIRM,
  ROUTINES_TERMS_TITLE
} from '@shared/routines-terms'
import { confirmDialog } from '../../../components/ConfirmDialog'
import { useSettings } from '../../../stores/settings'

/** Muestra el diálogo (foco en «Cancelar»); si el usuario acepta, guarda el reconocimiento. */
export async function showRoutinesTermsDialog(): Promise<boolean> {
  const ok = await confirmDialog({
    title: ROUTINES_TERMS_TITLE,
    message: ROUTINES_TERMS_BODY,
    confirmLabel: ROUTINES_TERMS_CONFIRM,
    cancelLabel: ROUTINES_TERMS_CANCEL,
    focusCancel: true
  })
  if (ok) await useSettings.getState().update({ routinesTermsAcknowledged: true })
  return ok
}

/**
 * Antes de crear/activar (o guardar activada) una rutina programada: true si se puede continuar
 * (ya reconocido o el usuario acaba de aceptar); false si canceló.
 */
export async function ensureRoutinesTermsAck(willBeEnabled: boolean): Promise<boolean> {
  if (!needsRoutinesConsent(useSettings.getState().settings.routinesTermsAcknowledged, willBeEnabled)) return true
  return showRoutinesTermsDialog()
}
