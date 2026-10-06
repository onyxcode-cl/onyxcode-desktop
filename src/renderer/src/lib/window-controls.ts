/**
 * Reserva derecha para los controles de ventana de Windows (`titleBarOverlay`): la barra de 48 px se extiende bajo ellos, así que las
 * cabeceras dejan ese hueco libre. Usa `navigator.windowControlsOverlay` cuando existe y, si no, el ancho por defecto. 0 fuera de Windows.
 */
import { useEffect, useState } from 'react'
import { controlsInsetRight } from '@shared/window-chrome'
import { currentPlatform } from './platform'

interface OverlayApi {
  visible: boolean
  getTitlebarAreaRect(): { x: number; width: number }
  addEventListener(type: 'geometrychange', cb: () => void): void
  removeEventListener(type: 'geometrychange', cb: () => void): void
}

const overlayApi = (): OverlayApi | null => {
  try {
    return (globalThis.navigator as unknown as { windowControlsOverlay?: OverlayApi }).windowControlsOverlay ?? null
  } catch {
    return null
  }
}

/** Reserva actual en px (plataforma y API inyectables para probar). */
export function readControlsInset(
  platform: string = currentPlatform(),
  api: Pick<OverlayApi, 'visible' | 'getTitlebarAreaRect'> | null = overlayApi(),
  viewportWidth: number = globalThis.window?.innerWidth ?? 0
): number {
  try {
    return controlsInsetRight(platform, api ? api.getTitlebarAreaRect() : null, viewportWidth, api ? api.visible : true)
  } catch {
    return controlsInsetRight(platform, null, viewportWidth)
  }
}

/** Hook: reserva derecha en px, actualizada con `geometrychange` y con el tamaño de la ventana. */
export function useControlsInset(): number {
  const [inset, setInset] = useState<number>(() => readControlsInset())
  useEffect(() => {
    if (currentPlatform() !== 'win32') return
    const api = overlayApi()
    const update = (): void => setInset(readControlsInset())
    update()
    api?.addEventListener('geometrychange', update)
    window.addEventListener('resize', update)
    return () => {
      api?.removeEventListener('geometrychange', update)
      window.removeEventListener('resize', update)
    }
  }, [])
  return inset
}
