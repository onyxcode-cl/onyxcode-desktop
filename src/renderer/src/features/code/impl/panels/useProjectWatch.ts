import { useEffect, useRef, useState } from 'react'
import type { FilesChangedEvent, FilesWatchMode } from '@shared/ipc-code'
import { nativeCode } from '../client'
import { useCode } from '../store'

export interface ProjectWatch {
  mode: FilesWatchMode | null
  /** La vigilancia se perdió (carpeta desconectada, límite del sistema…): queda el refresco manual. */
  lost: boolean
  /** Vuelve a suscribirse (lo usa el botón de refresco manual cuando se perdió). */
  resubscribe: () => void
}

/**
 * Suscribe el panel a los cambios de archivos de `directory` (eventos del sistema de archivos desde main, sin
 * polling) SOLO mientras el panel está montado y la ventana visible; al desmontar, cambiar de proyecto o ocultar
 * la ventana se libera el vigilante en main. Cada aviso sube `fsVersion` (refresca también el panel Cambios).
 * `dirs`: carpetas abiertas (solo se usan en Linux, donde se vigilan únicamente esas).
 */
export function useProjectWatch(
  directory: string,
  opts: { onChange?: (e: FilesChangedEvent) => void; dirs?: string[] } = {}
): ProjectWatch {
  const [mode, setMode] = useState<FilesWatchMode | null>(null)
  const [lost, setLost] = useState(false)
  const [nonce, setNonce] = useState(0)
  const onChangeRef = useRef(opts.onChange)
  onChangeRef.current = opts.onChange
  const subRef = useRef<string | null>(null)
  const modeRef = useRef<FilesWatchMode | null>(null)
  const dirsKey = (opts.dirs ?? []).slice().sort().join('\n')
  const dirsRef = useRef<string[]>([])
  dirsRef.current = opts.dirs ?? []

  useEffect(() => {
    const native = nativeCode()
    if (!native) return
    let cancelled = false
    let subId: string | null = null
    const start = (): void => {
      if (subId || cancelled) return
      const id = crypto.randomUUID()
      subId = id
      subRef.current = id
      setLost(false)
      native.files
        .watch(directory, id)
        .then(({ mode: m }) => {
          if (cancelled || subId !== id) {
            void native.files.unwatch(id).catch(() => undefined)
            return
          }
          modeRef.current = m
          setMode(m)
          if (m === 'none') setLost(true)
          else if (m === 'dirs') void native.files.setDirs(id, dirsRef.current).catch(() => undefined)
        })
        .catch(() => !cancelled && setLost(true))
    }
    const stop = (): void => {
      if (!subId) return
      const id = subId
      subId = null
      subRef.current = null
      void native.files.unwatch(id).catch(() => undefined)
    }
    const off = native.onFilesChanged((ev) => {
      if (ev.subId !== subId) return
      if (ev.status === 'lost') {
        setLost(true)
        return
      }
      useCode.getState().touchFs()
      onChangeRef.current?.(ev)
    })
    const onVis = (): void => {
      if (document.visibilityState === 'hidden') stop()
      else if (!subId) {
        start()
        // Lo que pasó mientras estaba oculta: un refresco al volver.
        useCode.getState().touchFs()
        onChangeRef.current?.({ subId: '', dirs: null, status: 'ok' })
      }
    }
    document.addEventListener('visibilitychange', onVis)
    if (document.visibilityState !== 'hidden') start()
    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', onVis)
      off()
      stop()
    }
  }, [directory, nonce])

  useEffect(() => {
    const native = nativeCode()
    const id = subRef.current
    if (native && id && modeRef.current === 'dirs') void native.files.setDirs(id, dirsRef.current).catch(() => undefined)
  }, [dirsKey])

  return { mode, lost, resubscribe: () => setNonce((n) => n + 1) }
}
