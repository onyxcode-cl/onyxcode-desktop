import { useCallback, useEffect, useState } from 'react'
import type { AccountState } from '@shared/account'
import { api, call } from './api'

/**
 * Estado de la cuenta: lectura inicial + evento `account:changed`. `null` hasta la primera respuesta;
 * `failed` si la lectura falló (y `reload` la repite).
 */
export function useAccountState(): [AccountState | null, (s: AccountState) => void, boolean, () => void] {
  const [state, setState] = useState<AccountState | null>(null)
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let alive = true
    call('account:state')
      .then((s) => {
        if (!alive) return
        setFailed(false)
        setState((cur) => cur ?? s)
      })
      .catch(() => alive && setFailed(true))
    const off = api.on('account:changed', (s) => setState(s))
    return () => {
      alive = false
      off()
    }
  }, [attempt])
  const reload = useCallback(() => setAttempt((n) => n + 1), [])
  return [state, setState, failed, reload]
}
