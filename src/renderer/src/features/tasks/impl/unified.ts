/**
 * Modo unificado (ola 2): ¿está encendido el puente de apps (`AppInfo.unifiedApps`, bandera `LAZUNOX_UNIFIED_APPS=1`)?
 * Se lee UNA vez de `app:info` y se guarda aquí. Apagado, ausente o sin puente = la interfaz de siempre.
 * También guarda la elección «Automático» hecha antes de que exista carpeta (se aplica al crearla al enviar).
 */
import { useEffect } from 'react'
import { create } from 'zustand'
import { setAutoModeSettings, useTasks } from './store'

interface UnifiedState {
  on: boolean
  loaded: boolean
  /** El usuario eligió «Automático» antes de tener carpeta: se aplica a la carpeta del chat al crearla. */
  wantAuto: boolean
  /** Ruta REAL que devolvió `tasks:chatFolder:create` en esta sesión (la carpeta automática del chat actual). */
  chatFolder: string | null
}

export const useUnified = create<UnifiedState>(() => ({ on: false, loaded: false, wantAuto: false, chatFolder: null }))

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

const normPath = (p: string): string => p.replace(/\\/g, '/').replace(/\/+$/, '')

/**
 * ¿Es una carpeta automática de chat? Lo decide MAIN (`TasksFolder.chat`, registro persistente + realpath, también tras reiniciar);
 * la ruta real que devolvió `tasks:chatFolder:create` en esta sesión queda como respaldo. Nunca por forma: una carpeta del usuario
 * con nombre parecido no se trata como carpeta de chat. Sirve para decidir.
 */
export function isChatFolderPath(path: string): boolean {
  const known = useUnified.getState().chatFolder
  if (known && normPath(known) === normPath(path)) return true
  return (useTasks.getState().folders ?? []).some((f) => f.chat === true && normPath(f.path) === normPath(path))
}

/** Solo para MOSTRAR un nombre (chats que ya existían tras reiniciar): la forma `…/Lazunox/Chats/<id>`. Nunca para decidir. */
export function looksLikeChatFolder(path: string): boolean {
  return /[\\/]Lazunox[\\/]Chats[\\/][^\\/]+[\\/]?$/.test(path)
}

/** ¿Mostrar esta carpeta como «chat sin carpeta»? (ruta real guardada o, para chats antiguos, la forma bajo ~/Lazunox/Chats). */
export function isChatFolderForDisplay(path: string): boolean {
  return isChatFolderPath(path) || looksLikeChatFolder(path)
}

/**
 * Enciende «Automático» SOLO para `folder`. Si el interruptor general estaba apagado, antes se quitan las demás carpetas y tareas que
 * quedaron en la lista (se veían como «Manual»), para que encenderlo no las reactive en silencio.
 */
export async function enableAutoOnlyFor(folder: string): Promise<void> {
  const settings = useTasks.getState().autoMode?.settings
  if (settings && !settings.enabled) {
    for (const f of settings.folders) if (f !== folder) await setAutoModeSettings({ folder: { path: f, on: false } })
    for (const sessionId of settings.tasks) await setAutoModeSettings({ task: { sessionId, on: false } })
  }
  await setAutoModeSettings({ enabled: true, folder: { path: folder, on: true } })
}

/** Fecha legible sacada del id de la carpeta de chat (`AAAAMMDD-xxxxxx`), o null si no se reconoce. */
export function chatFolderDate(path: string): string | null {
  const id = path.split(/[\\/]/).filter(Boolean).pop() ?? ''
  const m = /^(\d{4})(\d{2})(\d{2})-/.exec(id)
  if (!m) return null
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}
