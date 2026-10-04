import { useState, type ReactNode } from 'react'
import { Check, Copy, TextSelect } from 'lucide-react'
import { useT } from '../../lib/i18n'
import { SheetAction } from '../../features/code/impl/SheetAction'
import { Sheet } from './Sheet'

export interface MessageAction {
  label: string
  icon: ReactNode
  onSelect: () => void
  danger?: boolean
  disabled?: boolean
}

/**
 * Hoja de acciones de un mensaje (mantener pulsado en el celular): Copiar, Seleccionar texto y las acciones propias del
 * mensaje (Editar, Reintentar, Bifurcar, Revertir). «Seleccionar texto» abre otra hoja con el texto plano seleccionable.
 */
export function MessageActionsSheet({
  open,
  onClose,
  text,
  actions = [],
  subtitle
}: {
  open: boolean
  onClose: () => void
  text: string
  actions?: MessageAction[]
  subtitle?: string
}): React.JSX.Element {
  const t = useT()
  const [selecting, setSelecting] = useState(false)
  const [copied, setCopied] = useState(false)
  const copy = (): void => {
    void navigator.clipboard.writeText(text).then(
      () => {
        setCopied(true)
        setTimeout(() => {
          setCopied(false)
          onClose()
        }, 600)
      },
      () => undefined
    )
  }
  return (
    <>
      <Sheet open={open && !selecting} onClose={onClose} title={t('mobile.msg.actions')}>
        {subtitle && <p className="px-4 pb-2 text-[13px] text-muted">{subtitle}</p>}
        {text && (
          <>
            <SheetAction
              icon={copied ? <Check size={20} /> : <Copy size={20} />}
              label={copied ? t('chat.error.copied') : t('chat.msg.copyMessage')}
              onClick={copy}
            />
            <SheetAction icon={<TextSelect size={20} />} label={t('mobile.msg.select')} onClick={() => setSelecting(true)} />
          </>
        )}
        {actions.map((a) => (
          <SheetAction
            key={a.label}
            icon={a.icon}
            label={a.label}
            danger={a.danger}
            disabled={a.disabled}
            onClick={() => {
              onClose()
              a.onSelect()
            }}
          />
        ))}
      </Sheet>
      <Sheet
        open={open && selecting}
        onClose={() => {
          setSelecting(false)
          onClose()
        }}
        title={t('mobile.msg.select')}
        size="full"
      >
        <div className="px-4 pb-4 text-[16px] leading-relaxed whitespace-pre-wrap select-text">{text}</div>
      </Sheet>
    </>
  )
}

/** Botón de icono de la fila de acciones bajo la última respuesta (celular): círculo de 36 px, icono de 18. */
export function ActionIconButton({
  label,
  onClick,
  children
}: {
  label: string
  onClick: () => void
  children: ReactNode
}): React.JSX.Element {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      className="no-drag inline-flex h-9 w-9 items-center justify-center rounded-full text-muted active:bg-hover"
    >
      {children}
    </button>
  )
}

/** Copiar con confirmación breve (icono Check durante 1,2 s). */
export function CopyActionButton({ text, label }: { text: string; label: string }): React.JSX.Element {
  const [copied, setCopied] = useState(false)
  return (
    <ActionIconButton
      label={label}
      onClick={() => {
        void navigator.clipboard.writeText(text).then(
          () => {
            setCopied(true)
            setTimeout(() => setCopied(false), 1200)
          },
          () => undefined
        )
      }}
    >
      {copied ? <Check size={18} /> : <Copy size={18} />}
    </ActionIconButton>
  )
}
