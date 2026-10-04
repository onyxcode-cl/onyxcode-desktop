/**
 * Instalación en la pantalla de inicio (opcional; hace falta para los avisos en iOS, que no hay en esta entrega). Android/Chrome
 * ofrece `beforeinstallprompt`; iPhone solo tiene «Compartir › Añadir a pantalla de inicio» (se explica con texto). Todo es
 * opcional: sin soporte, la guía muestra solo las instrucciones.
 */
interface InstallEvent extends Event {
  prompt(): Promise<void>
}

let saved: InstallEvent | null = null
const listeners = new Set<() => void>()

export function watchInstall(): void {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault()
    saved = e as InstallEvent
    for (const fn of listeners) fn()
  })
  window.addEventListener('appinstalled', () => {
    saved = null
    for (const fn of listeners) fn()
  })
}

export function installAvailable(): boolean {
  return saved !== null
}

export function onInstallChange(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export async function promptInstall(): Promise<void> {
  const e = saved
  saved = null
  try {
    await e?.prompt()
  } catch {
    /* el usuario cerró el diálogo o el navegador no lo permite */
  }
  for (const fn of listeners) fn()
}

/** ¿Ya corre como app instalada? (no se ofrece instalarla otra vez). */
export function isStandalone(): boolean {
  try {
    return window.matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true
  } catch {
    return false
  }
}

/** Plataforma para elegir el texto de ayuda. */
export function platform(): 'ios' | 'android' | 'other' {
  const ua = navigator.userAgent
  return /iPhone|iPad|iPod/.test(ua) ? 'ios' : /Android/.test(ua) ? 'android' : 'other'
}
