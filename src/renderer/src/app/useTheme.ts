import { useEffect } from 'react'
import { useSettings } from '../stores/settings'

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
