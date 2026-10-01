import { Component, type ErrorInfo, type ReactNode } from 'react'
import { AlertTriangle } from 'lucide-react'
import { t } from '@shared/i18n'
import { Button } from './Button'

/** Texto que copia "Copiar detalle": mensaje, pila y pila de componentes (pura, testeable). */
export function formatErrorDetail(error: unknown, componentStack?: string | null): string {
  const e = error instanceof Error ? error : new Error(String(error))
  const parts = [`${e.name}: ${e.message}`]
  if (e.stack) parts.push(e.stack)
  if (componentStack) parts.push(`${t('common.error.componentStack')}${componentStack}`)
  return parts.join('\n\n')
}

interface Props {
  children: ReactNode
  /** Nombre de la zona, solo para el título del fallback y el log. */
  label?: string
}

interface State {
  error: Error | null
  componentStack: string | null
  /** Cambia en cada reintento para remontar los hijos desde cero. */
  attempt: number
}

/** Evita la ventana en blanco (F6-B13): un error de render en una vista muestra un fallback con reintento. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, componentStack: null, attempt: 0 }

  static getDerivedStateFromError(error: unknown): Partial<State> {
    return { error: error instanceof Error ? error : new Error(String(error)) }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(`[ErrorBoundary${this.props.label ? `:${this.props.label}` : ''}]`, error, info.componentStack)
    this.setState({ componentStack: info.componentStack ?? null })
  }

  private retry = (): void => {
    this.setState((s) => ({ error: null, componentStack: null, attempt: s.attempt + 1 }))
  }

  private copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(formatErrorDetail(this.state.error, this.state.componentStack))
    } catch {
      /* portapapeles no disponible: sin efecto */
    }
  }

  render(): ReactNode {
    const { error, attempt } = this.state
    if (!error)
      return (
        <div key={attempt} className="contents">
          {this.props.children}
        </div>
      )
    return (
      <div role="alert" className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
        <AlertTriangle size={28} className="text-danger" />
        <h2 className="text-[15px] font-semibold tracking-tight">
          {this.props.label ? t('common.error.titleIn', { label: this.props.label }) : t('common.error.title')}
        </h2>
        <p className="max-w-md text-sm break-words text-muted">{error.message || t('common.error.unknown')}</p>
        <div className="mt-1 flex items-center gap-2">
          <Button variant="primary" onClick={this.retry}>
            {t('common.retry')}
          </Button>
          <Button onClick={() => void this.copy()}>{t('common.error.copyDetail')}</Button>
        </div>
      </div>
    )
  }
}
