import { useEffect, useRef, useState } from 'react'
import { useCode } from './store'

/**
 * Versión de `fsVersion` que ve un panel: mientras la ventana está oculta se congela en `prev` (no hay razón para
 * lanzar `git status`/listar archivos que nadie ve); al volver a estar visible se pone al día con `current`.
 */
export function nextVisibleVersion(prev: number, current: number, hidden: boolean): number {
  return hidden ? prev : current
}

const isHidden = (): boolean => typeof document !== 'undefined' && document.visibilityState === 'hidden'

/** `fsVersion` de Code congelado mientras `document.visibilityState === 'hidden'` (evento `visibilitychange`). */
export function useVisibleFsVersion(): number {
  const fsVersion = useCode((s) => s.fsVersion)
  const [shown, setShown] = useState(fsVersion)
  const latest = useRef(fsVersion)
  latest.current = fsVersion
  useEffect(() => {
    setShown((prev) => nextVisibleVersion(prev, fsVersion, isHidden()))
  }, [fsVersion])
  useEffect(() => {
    const onChange = (): void => setShown((prev) => nextVisibleVersion(prev, latest.current, isHidden()))
    document.addEventListener('visibilitychange', onChange)
    return () => document.removeEventListener('visibilitychange', onChange)
  }, [])
  return shown
}
