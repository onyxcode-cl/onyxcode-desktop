import { useT } from '../../lib/i18n'
import { Sheet } from './Sheet'

/** Visor de imagen a pantalla casi completa (celular): se amplía con el gesto de pellizco del navegador. */
export function ImageViewer({
  src,
  alt,
  open,
  onClose
}: {
  src: string
  alt: string
  open: boolean
  onClose: () => void
}): React.JSX.Element {
  const t = useT()
  return (
    <Sheet open={open} onClose={onClose} title={alt || t('mobile.image.open')} size="full">
      <div
        className="flex items-center justify-center overflow-auto bg-bg px-2 pb-4"
        style={{ height: 'calc(var(--vv-height, 100dvh) - env(safe-area-inset-top, 0px) - 96px)' }}
      >
        <img src={src} alt={alt} className="max-h-full max-w-full object-contain" style={{ touchAction: 'pinch-zoom' }} />
      </div>
    </Sheet>
  )
}

/** Imagen de un mensaje: en el celular va dentro de un botón que abre el visor (el escritorio la pinta tal cual). */
export function TappableImage({
  open,
  setOpen,
  src,
  alt,
  className,
  children
}: {
  open: boolean
  setOpen: (v: boolean) => void
  src: string
  alt: string
  className?: string
  children: React.ReactNode
}): React.JSX.Element {
  const t = useT()
  return (
    <>
      <button type="button" aria-label={t('mobile.image.open')} onClick={() => setOpen(true)} className={className}>
        {children}
      </button>
      <ImageViewer src={src} alt={alt} open={open} onClose={() => setOpen(false)} />
    </>
  )
}
