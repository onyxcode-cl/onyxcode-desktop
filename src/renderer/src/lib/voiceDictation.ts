/**
 * Dictado por voz: graba del micrófono con las APIs web de siempre (`getUserMedia`/`MediaRecorder`,
 * el permiso de micrófono ya está declarado para la grabadora de skills — `NSMicrophoneUsageDescription`
 * en `electron-builder.js`), decodifica a PCM y lo manda a main (`extras:transcribeAudio`) para que
 * Whisper lo transcriba ahí — 100% local, el audio nunca sale de la máquina. Un solo hook, compartido
 * por los composer de Chat/Code/Tareas: cada uno solo pone el botón y qué hacer con el texto.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { getExtras } from './extrasApi'

/** Whisper espera PCM mono de 16 kHz — la grabación puede salir a cualquier frecuencia según el
 * micrófono/SO, así que siempre se remuestrea a esto antes de mandarla (interpolación lineal: de
 * sobra para voz, no hace falta nada más fino). */
const TARGET_RATE = 16_000

function resampleTo16k(buffer: AudioBuffer): Float32Array {
  const channel = buffer.getChannelData(0)
  if (buffer.sampleRate === TARGET_RATE) return channel
  const ratio = buffer.sampleRate / TARGET_RATE
  const outLength = Math.max(1, Math.floor(channel.length / ratio))
  const out = new Float32Array(outLength)
  for (let i = 0; i < outLength; i++) {
    const srcIndex = i * ratio
    const i0 = Math.floor(srcIndex)
    const i1 = Math.min(i0 + 1, channel.length - 1)
    const frac = srcIndex - i0
    out[i] = channel[i0] * (1 - frac) + channel[i1] * frac
  }
  return out
}

async function blobToSamples(blob: Blob): Promise<Float32Array> {
  const arrayBuffer = await blob.arrayBuffer()
  const ctx = new AudioContext()
  try {
    const audioBuffer = await ctx.decodeAudioData(arrayBuffer)
    return resampleTo16k(audioBuffer)
  } finally {
    void ctx.close()
  }
}

export interface VoiceDictationState {
  /** Grabando ahora mismo. */
  recording: boolean
  /** Ya se soltó el botón, transcribiendo (Whisper corriendo). */
  busy: boolean
  /** Si `busy` y esto no es null: bajando el modelo por primera vez, de 0 a 100 (nunca más de una vez
   * por instalación — se cachea en `userData`). `null` cuando no hay descarga en curso. */
  downloadProgress: number | null
  error: string | null
  /** Empieza a grabar si no había nada en curso; si ya estaba grabando, no hace nada (usar `stop`). */
  start: () => void
  /** Corta la grabación, transcribe y llama a `onText` con el resultado (si no vino vacío). */
  stop: () => void
}

/** `onText`: se llama con el texto transcrito (nunca con uno vacío/solo espacios). */
export function useVoiceDictation(onText: (text: string) => void): VoiceDictationState {
  const [recording, setRecording] = useState(false)
  const [busy, setBusy] = useState(false)
  const [downloadProgress, setDownloadProgress] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const streamRef = useRef<MediaStream | null>(null)

  useEffect(() => {
    const extras = getExtras()
    if (!extras) return
    return extras.on('extras:voiceModelProgress', (ev) => {
      setDownloadProgress(ev.status === 'downloading' ? ev.progress : null)
    })
  }, [])

  const start = useCallback((): void => {
    if (recorderRef.current) return
    setError(null)
    void (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
        streamRef.current = stream
        chunksRef.current = []
        const recorder = new MediaRecorder(stream)
        recorder.ondataavailable = (e) => {
          if (e.data.size > 0) chunksRef.current.push(e.data)
        }
        recorderRef.current = recorder
        recorder.start()
        setRecording(true)
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      }
    })()
  }, [])

  const stop = useCallback((): void => {
    const recorder = recorderRef.current
    const stream = streamRef.current
    if (!recorder) return
    recorderRef.current = null
    setRecording(false)
    setBusy(true)
    setDownloadProgress(null)
    recorder.onstop = () => {
      void (async () => {
        try {
          stream?.getTracks().forEach((t) => t.stop())
          streamRef.current = null
          const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' })
          chunksRef.current = []
          if (blob.size === 0) return
          const samples = await blobToSamples(blob)
          const extras = getExtras()
          if (!extras) throw new Error('Sin acceso a main')
          const text = await extras.transcribeAudio(samples)
          if (text.trim()) onText(text.trim())
        } catch (err) {
          setError(err instanceof Error ? err.message : String(err))
        } finally {
          setBusy(false)
          setDownloadProgress(null)
        }
      })()
    }
    recorder.stop()
  }, [onText])

  return { recording, busy, downloadProgress, error, start, stop }
}
