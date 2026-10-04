import { useEffect, useState } from 'react'

/** Reloj que se actualiza cada `everyMs` mientras `active` (cuenta atrás de reintentos, duración en vivo). */
export function useNow(active: boolean, everyMs = 1000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    setNow(Date.now())
    const id = setInterval(() => setNow(Date.now()), everyMs)
    return () => clearInterval(id)
  }, [active, everyMs])
  return active ? now : Date.now()
}
