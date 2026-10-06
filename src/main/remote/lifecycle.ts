/**
 * ¿Debe cerrarse la app al cerrar su última ventana? macOS nunca (se queda en el Dock: el control remoto sigue atendiendo sin ventana).
 * Windows y Linux sí, SALVO en Windows con el control remoto activo (bandera `remoteWin`) y la bandeja del sistema visible: entonces
 * se queda viva en la bandeja, desde donde «Cortar acceso del celular» y «Salir» siguen a mano. Sin bandeja (el dueño la apagó) no hay
 * forma de reabrirla ni de salir, así que se cierra como siempre. El remoto se apaga solo a los 30 min sin conexión. Puro.
 */
export interface QuitDecisionInput {
  platform: string
  remoteWinOn: boolean
  remoteActive: boolean
  hasTray: boolean
}

export function shouldQuitWhenAllWindowsClosed(i: QuitDecisionInput): boolean {
  if (i.platform === 'darwin') return false
  if (i.platform === 'win32' && i.remoteWinOn && i.remoteActive && i.hasTray) return false
  return true
}
