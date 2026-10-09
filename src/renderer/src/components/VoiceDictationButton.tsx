/**
 * Botón de dictado por voz, compartido por los composer de Chat/Code/Tareas — un solo clic empieza a
 * grabar, otro clic corta y transcribe (Whisper local, `useVoiceDictation`). El texto transcrito se
 * entrega vía `onText`; cada composer decide cómo insertarlo (agregar al final, en el cursor, etc.).
 */
import { Loader2, Mic, Square } from 'lucide-react'
import { UI_LABELS } from '@shared/labels'
import { useT } from '../lib/i18n'
import { useVoiceDictation } from '../lib/voiceDictation'
import { getExtras } from '../lib/extrasApi'

interface Props {
  onText: (text: string) => void
  className?: string
  size?: number
}

export function VoiceDictationButton({ onText, className = '', size = 16 }: Props): React.JSX.Element | null {
  const t = useT()
  const extras = getExtras()
  const { recording, busy, downloadProgress, error, start, stop } = useVoiceDictation(onText)
  if (!extras) return null

  const downloading = downloadProgress !== null
  const label = error
    ? error
    : recording
      ? UI_LABELS.voiceStop
      : downloading
        ? t('labels.ui.voiceDownloading', { progress: downloadProgress })
        : busy
          ? UI_LABELS.voiceTranscribing
          : UI_LABELS.voiceStart

  return (
    <button
      type="button"
      onClick={recording ? stop : start}
      disabled={busy}
      title={label}
      aria-label={label}
      aria-pressed={recording}
      className={`no-drag inline-flex items-center gap-1.5 rounded-md p-1.5 transition-colors disabled:opacity-50 ${
        recording ? 'bg-danger/10 text-danger hover:bg-danger/20' : 'text-muted hover:bg-hover hover:text-fg'
      } ${className}`}
    >
      {busy ? <Loader2 size={size} className="animate-spin" /> : recording ? <Square size={size} /> : <Mic size={size} />}
      {downloading && <span className="text-xs whitespace-nowrap">{downloadProgress}%</span>}
    </button>
  )
}
