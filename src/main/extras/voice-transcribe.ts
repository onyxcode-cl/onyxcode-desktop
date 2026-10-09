/**
 * Dictado por voz: `sherpa-onnx` con un modelo Zipformer en streaming para español — NO whisper.cpp.
 * Motivo (F8-B147): medido con audio real, esto transcribe en ~100-150 ms por frase (whisper.cpp con
 * el modelo "medium" tardaba ~2 s) con la misma precisión de palabras, pesa menos (156 MB en total
 * contra 539 MB) y YA trae un binario precompilado para Windows (`sherpa-onnx-win-x64` en npm, sin
 * compilar nada aparte) — resuelve a la vez "tiene que ser instantáneo" y "no quedar tirados en
 * Windows". Probado con audio vacío/corto/ruido/silencio/buffer con NaN sin crashear nunca.
 *
 * Módulo PURO (sin nada de Electron) — la descarga de los modelos usa solo `fetch`/`node:fs`, así
 * sigue siendo testeable sin un runtime real.
 */
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { OnlineRecognizer, type OnlineStream } from 'sherpa-onnx-node'
import { downloadPinnedFile } from '../util/pinned-fetch'

/** Zipformer2 en streaming para español (proyecto Kroko, motor Apache-2.0 / modelo comunitario
 * CC-BY-SA) — tamaño y SHA-256 reales de cada archivo, sacados de la API de Hugging Face, no
 * inventados. */
const MODEL_BASE_URL = 'https://huggingface.co/csukuangfj/sherpa-onnx-streaming-zipformer-es-kroko-2025-08-06/resolve/main'
interface ModelFile {
  name: string
  size: number
  sha256: string
}
const MODEL_FILES: readonly ModelFile[] = [
  { name: 'encoder.onnx', size: 154_878_102, sha256: '2d9f5ef87d1a5257f8a6687e21501c56f3aa2fcbfcfab9364dcc4ce4e06ae81b' },
  { name: 'decoder.onnx', size: 617_488, sha256: 'd4ce176b94b25f7acc88717bc3f704fcf5d6e131aaac2e0cabab3885541181ee' },
  { name: 'joiner.onnx', size: 336_817, sha256: 'dae35df88d676e320fcdb99217328e66dcf722bf11b0f2459e14ddb5b982ded5' },
  { name: 'tokens.txt', size: 6_385, sha256: '1be5e0a58e05d06d327df4c6b7b5e4f8aba01da6981eb016fcaceafc6a56680f' }
]
const TOTAL_MODEL_SIZE = MODEL_FILES.reduce((sum, f) => sum + f.size, 0)

export interface VoiceModelProgress {
  status: 'downloading' | 'ready'
  progress: number
}

type ProgressListener = (info: VoiceModelProgress) => void
const progressListeners = new Set<ProgressListener>()

function reportProgress(info: VoiceModelProgress): void {
  progressListeners.forEach((fn) => fn(info))
}

export function onVoiceModelProgress(listener: ProgressListener): () => void {
  progressListeners.add(listener)
  return () => progressListeners.delete(listener)
}

/** `voice-worker-host.ts` (sí tiene Electron) la fija a una carpeta de `userData` al lanzar el
 * proceso; el valor de acá es solo un respaldo para cuando este módulo corre suelto (p.ej. pruebas). */
function modelsDir(): string {
  return process.env.LAZUNOX_VOICE_MODEL_DIR || join(tmpdir(), 'lazunox-voice-models')
}

/** Descarga los 4 archivos del modelo en paralelo (una sola vez, cacheados entre arranques —
 * integridad por SHA-256 vía `downloadPinnedFile`); el progreso avisado es la suma de bytes de los 4,
 * dominada por `encoder.onnx` (154 de los 156 MB totales). */
async function downloadModel(): Promise<{ encoder: string; decoder: string; joiner: string; tokens: string }> {
  const received = new Array(MODEL_FILES.length).fill(0)
  const report = (): void => {
    const total = received.reduce((a, b) => a + b, 0)
    reportProgress({ status: 'downloading', progress: Math.min(99, Math.round((total / TOTAL_MODEL_SIZE) * 100)) })
  }
  const paths = await Promise.all(
    MODEL_FILES.map(async (f, i) => {
      const dest = join(modelsDir(), f.name)
      await downloadPinnedFile(`${MODEL_BASE_URL}/${f.name}`, dest, f.size, f.sha256, {
        onBytes: (r) => {
          received[i] = r
          report()
        }
      })
      return dest
    })
  )
  reportProgress({ status: 'ready', progress: 100 })
  return { encoder: paths[0], decoder: paths[1], joiner: paths[2], tokens: paths[3] }
}

let recognizerPromise: Promise<OnlineRecognizer> | null = null

function loadRecognizer(): Promise<OnlineRecognizer> {
  if (!recognizerPromise) {
    recognizerPromise = (async () => {
      const { encoder, decoder, joiner, tokens } = await downloadModel()
      return new OnlineRecognizer({
        featConfig: { sampleRate: 16_000, featureDim: 80 },
        modelConfig: {
          transducer: { encoder, decoder, joiner },
          tokens,
          numThreads: 4,
          provider: 'cpu',
          modelType: 'zipformer2'
        },
        decodingMethod: 'greedy_search',
        enableEndpoint: false
      })
    })().catch((err: unknown) => {
      recognizerPromise = null
      throw err
    })
  }
  return recognizerPromise
}

const SAMPLE_RATE = 16_000
const MAX_SAMPLES = SAMPLE_RATE * 120
/** Cola de silencio al final: medido con audio real (F8-B147) — el modelo necesita este margen para
 * terminar de emitir las últimas palabras. 0.4 s (lo que usan los ejemplos oficiales) no alcanzaba en
 * frases largas y se comía el final; 2 s dio resultado exacto en todas las pruebas (frases cortas,
 * largas de ~17 s, y los casos límite de audio vacío/corto/ruido/silencio). */
const TAIL_SILENCE_SECONDS = 2

function drain(recognizer: OnlineRecognizer, stream: OnlineStream): void {
  while (recognizer.isReady(stream)) recognizer.decode(stream)
}

export async function transcribeAudio(samples: Float32Array): Promise<string> {
  if (samples.length === 0) return ''
  const clipped = samples.length > MAX_SAMPLES ? samples.subarray(0, MAX_SAMPLES) : samples
  const recognizer = await loadRecognizer()
  const stream = recognizer.createStream()
  stream.acceptWaveform({ samples: clipped, sampleRate: SAMPLE_RATE })
  drain(recognizer, stream)
  stream.acceptWaveform({ samples: new Float32Array(SAMPLE_RATE * TAIL_SILENCE_SECONDS), sampleRate: SAMPLE_RATE })
  drain(recognizer, stream)
  return recognizer.getResult(stream).text.trim()
}
