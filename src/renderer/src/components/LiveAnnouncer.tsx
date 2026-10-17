import { useEffect, useState } from 'react'
import { subscribeAnnouncements } from '../lib/announce'

/**
 * Regiones vivas permanentes (solo lectores de pantalla) para `announce()` de `lib/announce.ts`. Se vacía y se vuelve a
 * escribir en el siguiente fotograma para que un mismo texto repetido («Copiado») se lea otra vez, y se limpia a los 6 s.
 */
export function LiveAnnouncer(): React.JSX.Element {
  const [polite, setPolite] = useState('')
  const [assertive, setAssertive] = useState('')
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const unsub = subscribeAnnouncements((a) => {
      const set = a.tone === 'assertive' ? setAssertive : setPolite
      set('')
      requestAnimationFrame(() => set(a.text))
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        setPolite('')
        setAssertive('')
      }, 6000)
    })
    return () => {
      unsub()
      if (timer) clearTimeout(timer)
    }
  }, [])
  return (
    <div className="sr-only" data-testid="live-announcer">
      <div role="status" aria-live="polite" aria-atomic="true">
        {polite}
      </div>
      <div role="alert" aria-live="assertive" aria-atomic="true">
        {assertive}
      </div>
    </div>
  )
}
