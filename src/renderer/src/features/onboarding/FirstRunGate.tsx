/**
 * Recorrido de la primera vez, siempre en este orden y UNA sola cosa a la vez (cada pantalla cubre la app entera, sin la pantalla de inicio detrás):
 *   1) Bienvenida (`Welcome`): solo saluda y dice qué viene.
 *   2) «Preparando» (`PreflightGate`): la lista de piezas con casillas, estado y tamaño; «Instalar lo marcado» o «Más tarde».
 *      Si no hay nada pendiente no aparece (se pasa directo al 3).
 *   3) Conectar la IA (`OnboardingGate`): cuenta, modelo, modos y cierre.
 * Quien ya terminó el asistente (`onboarded`) no ve la bienvenida: solo la revisión de arranque de siempre (`PreflightGate`).
 * Con el mismo `PreflightGate` en ambos casos, al terminar el asistente no se vuelve a montar ni a revisar.
 */
import { useState } from 'react'
import { useSettings } from '../../stores/settings'
import { OnboardingGate } from './Wizard'
import { PreflightGate } from './PreflightGate'
import { Welcome } from './Welcome'

export function FirstRunGate(): React.JSX.Element {
  const loaded = useSettings((s) => s.loaded)
  const onboarded = useSettings((s) => s.settings.onboarded)
  const [welcomed, setWelcomed] = useState(false)
  if (!loaded) return <div className="fixed inset-0 z-[60] bg-bg" aria-busy="true" data-testid="firstrun-loading" />
  if (!onboarded && !welcomed) return <Welcome onDone={() => setWelcomed(true)} />
  return (
    <PreflightGate>
      <OnboardingGate />
    </PreflightGate>
  )
}
