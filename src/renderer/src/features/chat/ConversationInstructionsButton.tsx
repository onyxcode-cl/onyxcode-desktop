/**
 * «Instrucciones de esta conversación»: botón de la cabecera de Chat + panel pequeño con un campo de texto (tope
 * `MAX_CONVERSATION_INSTRUCTIONS`). Se guardan por sesión en este computador y viajan en el `system` de ESA conversación
 * (marco de datos de `personal-context.ts`); un punto discreto en el botón indica que hay instrucciones activas.
 * Solo escritorio: la cabecera de Chat no se pinta en el celular.
 */
import { MessageSquareText } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { MAX_CONVERSATION_INSTRUCTIONS } from '@shared/personal-context'
import { Button } from '../../components/Button'
import { DialogFrame } from '../../components/DialogFrame'
import { IconButton } from '../../components/IconButton'
import { useT } from '../../lib/i18n'
import { isRemoteSurface } from '../../lib/platform'
import { setConversationInstructions, useConversationInstructions } from './conversation-instructions'

const TEXTAREA =
  'w-full resize-y rounded-lg border border-border bg-bg px-3 py-2 text-sm outline-none transition focus:border-border-strong focus:ring-2 focus:ring-accent/15 placeholder:text-subtle'

function InstructionsPanel({ sessionId, onClose }: { sessionId: string; onClose: () => void }): React.JSX.Element {
  const t = useT()
  const saved = useConversationInstructions(sessionId)
  const [value, setValue] = useState(saved)
  const ref = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.focus()
    el.setSelectionRange(el.value.length, el.value.length)
  }, [])
  const save = (): void => {
    setConversationInstructions(sessionId, value)
    onClose()
  }
  const clear = (): void => {
    setConversationInstructions(sessionId, '')
    onClose()
  }
  return (
    <DialogFrame
      title={t('chat.convInstr.title')}
      onClose={onClose}
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={clear} disabled={!saved && !value} data-testid="conv-instr-clear">
            {t('chat.convInstr.clear')}
          </Button>
          <Button variant="secondary" onClick={onClose}>
            {t('chat.convInstr.close')}
          </Button>
          <Button variant="primary" onClick={save} data-testid="conv-instr-save">
            {t('chat.convInstr.save')}
          </Button>
        </>
      }
    >
      <p className="text-ui text-muted">{t('chat.convInstr.intro')}</p>
      <textarea
        ref={ref}
        data-testid="conv-instr-text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        maxLength={MAX_CONVERSATION_INSTRUCTIONS}
        rows={5}
        placeholder={t('chat.convInstr.placeholder')}
        aria-label={t('chat.convInstr.title')}
        aria-describedby="conv-instr-help"
        className={`mt-3 min-h-28 ${TEXTAREA}`}
      />
      <div className="mt-1 text-meta text-subtle">
        {t('chat.convInstr.count', { count: value.length, max: MAX_CONVERSATION_INSTRUCTIONS })}
      </div>
      <p id="conv-instr-help" className="mt-2 text-meta leading-relaxed text-muted">
        {t('chat.convInstr.help')} {t('chat.convInstr.global')}
      </p>
    </DialogFrame>
  )
}

export function ConversationInstructionsButton({ sessionId }: { sessionId: string | null }): React.JSX.Element | null {
  const t = useT()
  const [open, setOpen] = useState(false)
  const saved = useConversationInstructions(sessionId)
  if (isRemoteSurface() || !sessionId) return null
  const active = saved.trim().length > 0
  return (
    <>
      <span className="relative inline-flex">
        <IconButton
          label={t(active ? 'chat.convInstr.active' : 'chat.convInstr.button')}
          tooltip
          size="sm"
          className="no-drag"
          data-testid="conv-instr-button"
          aria-haspopup="dialog"
          onClick={() => setOpen(true)}
        >
          <MessageSquareText size={14} />
        </IconButton>
        {active && (
          <span
            aria-hidden="true"
            data-testid="conv-instr-dot"
            className="pointer-events-none absolute top-[3px] right-[3px] size-[7px] rounded-full bg-accent ring-2 ring-bg"
          />
        )}
      </span>
      {/* En el body: la cabecera tiene `backdrop-blur` y un `fixed` dentro de ella se pegaría a la cabecera, no a la ventana. */}
      {open && createPortal(<InstructionsPanel sessionId={sessionId} onClose={() => setOpen(false)} />, document.body)}
    </>
  )
}
