import { Suspense, lazy, type ComponentProps } from 'react'

// PWA del celular: react-markdown, remark, micromark… (~49 KB gzip) se bajan aparte; el arranque precarga el trozo en un rato
// ocioso (`boot.tsx`). Mientras llega, el texto se ve plano (sin formato) para que la conversación nunca espere.
export { CopyButton } from '@renderer/components/CopyButton'

const Real = lazy(() => import('@renderer/components/Markdown').then((m) => ({ default: m.Markdown })))

export function Markdown(props: ComponentProps<typeof Real>): React.JSX.Element {
  return (
    <Suspense
      fallback={
        <div className={`markdown ${props.streaming ? 'is-streaming' : ''} ${props.className ?? ''}`}>
          <p style={{ whiteSpace: 'pre-wrap' }}>{props.text}</p>
        </div>
      }
    >
      <Real {...props} />
    </Suspense>
  )
}
