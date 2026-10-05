import { SettingsView } from '../../features/settings'
import { MODES_BY_ID } from '../modes'
import { useMobileNav, SETTINGS_PREFIX } from './nav'
import './settings.css'

/**
 * «Ajustes»: una sola pantalla apilada con la tarjeta de conexión (Bloquear, Desvincular) y los grupos. La tarjeta y los grupos
 * los dibuja `SettingsView mobile` (features/settings); «phone» ya no es una pantalla aparte: se resuelve igual que «settings».
 */
export function SettingsHome(): React.JSX.Element {
  const { push } = useMobileNav()
  return <SettingsView mobile={{ onOpen: (id) => push(SETTINGS_PREFIX + id) }} />
}

/** Compatibilidad con el nombre de pantalla `phone` (redirige a Ajustes). */
export const PhoneScreen = SettingsHome

/** Rutinas (la vista de siempre; en la PWA se descarga al entrar). */
export function RoutinesScreen(): React.JSX.Element {
  const View = MODES_BY_ID.routines.View
  return <View />
}
