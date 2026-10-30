import { useEffect } from 'react'
import { useSettings } from '../stores/settings'
import { currentFlags } from '../lib/platform'

/** Aplica el tema (data-theme en <html>) según ajustes y preferencia del sistema. */
export function useTheme(): void {
  const theme = useSettings((s) => s.settings.theme)
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = (): void => {
      const resolved = theme === 'system' ? (mq.matches ? 'dark' : 'light') : theme
      document.documentElement.dataset.theme = resolved
    }
    apply()
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [theme])
}

/**
 * Barra lateral de vidrio: pone `data-glass` («soft» / «glass») en <html> solo si el sistema lo permite y la persona no pidió menos
 * transparencia; sin el atributo todo se pinta como siempre (sólido).
 */
export function useSidebarGlass(): void {
  const level = useSettings((s) => s.settings.sidebarGlass)
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-transparency: reduce)')
    const apply = (): void => {
      const on = currentFlags().glass === true && (level === 'soft' || level === 'glass') && !mq.matches
      if (on) document.documentElement.dataset.glass = level
      else delete document.documentElement.dataset.glass
    }
    apply()
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [level])
}
