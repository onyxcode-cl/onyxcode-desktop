/**
 * Primera apertura: bienvenida → preparar → permisos (si estaban pendientes) → conectar la IA.
 * La revisión local determina el recorrido antes de anunciarlo; las descargas empiezan al pulsar «Empezar».
 * El mismo PreflightGate permanece montado al terminar el asistente y atiende las revisiones posteriores.
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
  return (
    <PreflightGate welcome={!onboarded && !welcomed ? (total) => <Welcome total={total} onDone={() => setWelcomed(true)} /> : undefined}>
      {(total) => <OnboardingGate total={total} />}
    </PreflightGate>
  )
}
