/**
 * Modo unificado (ola 2): ¿está encendido el puente de apps (`AppInfo.unifiedApps`, bandera `LAZUNOX_UNIFIED_APPS=1`)?
 * Se lee UNA vez de `app:info` y se guarda aquí. Apagado, ausente o sin puente = la interfaz de siempre.
 * También guarda la elección «Automático» hecha antes de que exista carpeta (se aplica al crearla al enviar).
 */
import { useEffect } from 'react'
import { create } from 'zustand'

interface UnifiedState {
  on: boolean
  loaded: boolean
  /** El usuario eligió «Automático» antes de tener carpeta: se aplica a la carpeta del chat al crearla. */
  wantAuto: boolean
}

export const useUnified = create<UnifiedState>(() => ({ on: false, loaded: false, wantAuto: false }))

/** Lee `app:info` una sola vez; un fallo deja el modo apagado (comportamiento de siempre). */
export async function loadUnified(): Promise<void> {
  if (useUnified.getState().loaded) return
  useUnified.setState({ loaded: true })
  try {
    const api = (
      globalThis as { window?: { api?: { invoke?: (c: string) => Promise<{ ok: boolean; data?: { unifiedApps?: boolean } }> } } }
    ).window?.api
    const r = await api?.invoke?.('app:info')
    if (r?.ok) useUnified.setState({ on: r.data?.unifiedApps === true })
  } catch {
    // sin puente: queda apagado
  }
}

/** Hook: true solo si el modo unificado está encendido. Dispara la lectura la primera vez. */
export function useUnifiedApps(): boolean {
  const on = useUnified((s) => s.on)
  useEffect(() => {
    void loadUnified()
  }, [])
  return on
}

/** ¿Es una carpeta propia de chat (`~/Lazunox/Chats/<id>`, creada por la app)? Se muestra como «Sin carpeta elegida». */
export function isChatFolderPath(path: string): boolean {
  return /[\\/]Lazunox[\\/]Chats[\\/][^\\/]+[\\/]?$/.test(path)
}
