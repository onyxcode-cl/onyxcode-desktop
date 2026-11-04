import { useSyncExternalStore } from 'react'

export type AppTheme = 'light' | 'dark'

export function currentAppTheme(): AppTheme {
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'
}

function subscribe(onChange: () => void): () => void {
  const obs = new MutationObserver(onChange)
  obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
  return () => obs.disconnect()
}

/** Tema que la app tiene puesto ahora (`data-theme` de <html>); se actualiza al cambiarlo. Los visores lo usan para reabrirse con el tema nuevo. */
export function useAppTheme(): AppTheme {
  return useSyncExternalStore(subscribe, currentAppTheme, () => 'light')
}
