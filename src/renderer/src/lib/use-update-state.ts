import { useEffect, useState } from 'react'
import type { UpdateState } from '@shared/update-check'
import { api, call } from './api'

/** Estado del aviso de versión nueva: lectura inicial + evento `app:updateState`. */
export function useUpdateState(): [UpdateState | null, (s: UpdateState) => void] {
  const [state, setState] = useState<UpdateState | null>(null)
  useEffect(() => {
    let alive = true
    call('app:updateState')
      .then((s) => alive && setState((cur) => cur ?? s))
      .catch(() => undefined)
    const off = api.on('app:updateState', (s) => setState(s))
    return () => {
      alive = false
      off()
    }
  }, [])
  return [state, setState]
}
