/**
 * Proceso APARTE para el dictado por voz (`utilityProcess` de main, mismo patrón que
 * `computer/mcp-server.ts`) — build entry propio: `out/main/voice-worker.js`.
 *
 * Por qué un proceso aparte (F8-B144): se probó corriendo `transcribeAudio` directo en el proceso
 * principal y el motor de ese momento (ONNX Runtime) tiró un crash nativo de verdad que se llevó TODA
 * la app — un `try/catch` de JS nunca iba a agarrar eso, un crash nativo mata el proceso entero. Un
 * `utilityProcess` aislado significa que si un futuro motor vuelve a fallar así, muere SOLO este
 * proceso chico; main lo nota (`voice-worker-host.ts`) y puede avisar "no se pudo transcribir, probá
 * de nuevo" en vez de cerrarse solo. Se mantiene aunque el motor actual (F8-B147, sherpa-onnx) no
 * mostró este problema en las pruebas — es aislamiento gratis, no cuesta nada mantenerlo.
 *
 * A propósito SOLO importa `./voice-transcribe` (puro, sin nada de Electron/main) — mismo criterio de
 * autocontención que ya documenta `mcp-server.ts` para su propio bundle.
 */
import { transcribeAudio, onVoiceModelProgress } from './voice-transcribe'

interface ParentPort {
  postMessage(message: unknown): void
  on(event: 'message', listener: (e: { data: unknown }) => void): void
}

interface TranscribeRequest {
  type: 'transcribe'
  id: number
  samples: Float32Array
}

function main(): void {
  const parent = (process as unknown as { parentPort?: ParentPort }).parentPort
  if (!parent) {
    process.exit(1)
    return
  }

  onVoiceModelProgress((p) => parent.postMessage({ type: 'progress', status: p.status, progress: p.progress }))

  parent.on('message', (e) => {
    const msg = e.data as Partial<TranscribeRequest>
    if (msg.type !== 'transcribe' || typeof msg.id !== 'number') return
    const id = msg.id
    const samples = msg.samples instanceof Float32Array ? msg.samples : new Float32Array(0)
    transcribeAudio(samples)
      .then((text) => parent.postMessage({ type: 'result', id, text }))
      .catch((err: unknown) => parent.postMessage({ type: 'error', id, message: err instanceof Error ? err.message : String(err) }))
  })

  parent.postMessage({ type: 'ready' })
}

main()
