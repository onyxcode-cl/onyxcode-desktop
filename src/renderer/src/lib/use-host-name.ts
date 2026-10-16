import { useEffect, useState } from 'react'
import { call } from './api'

let cached: string | null = null

/** Nombre del equipo (`os.hostname()` desde main); `null` mientras carga o si falla (no es crítico). */
export function useHostName(): string | null {
  const [name, setName] = useState<string | null>(cached)
  useEffect(() => {
    if (cached !== null) return
    let alive = true
    call('app:hostName')
      .then((n) => {
        cached = n
        if (alive) setName(n)
      })
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [])
  return name
}
