import { describe, expect, it, vi, beforeEach } from 'vitest'

type OnBytes = (received: number, total: number) => void
const downloadPinnedFileMock = vi.fn(async (_url: string, _dest: string, size: number, _sha256: string, opts?: { onBytes?: OnBytes }) => {
  opts?.onBytes?.(size, size)
})
vi.mock('../util/pinned-fetch', () => ({
  downloadPinnedFile: (...args: Parameters<typeof downloadPinnedFileMock>) => downloadPinnedFileMock(...args)
}))

let nextText = 'ok'
const acceptWaveformCalls: Array<{ samples: Float32Array; sampleRate: number }> = []

class OnlineStreamMock {
  acceptWaveform(input: { samples: Float32Array; sampleRate: number }): void {
    acceptWaveformCalls.push(input)
  }
  inputFinished(): void {}
}

class OnlineRecognizerMock {
  static instances = 0
  constructor(public config: unknown) {
    OnlineRecognizerMock.instances++
  }
  createStream(): OnlineStreamMock {
    return new OnlineStreamMock()
  }
  isReady(_stream: OnlineStreamMock): boolean {
    return false
  }
  decode(_stream: OnlineStreamMock): void {}
  getResult(_stream: OnlineStreamMock): { text: string } {
    return { text: nextText }
  }
}
vi.mock('sherpa-onnx-node', () => ({ OnlineRecognizer: OnlineRecognizerMock }))

describe('transcribeAudio: dictado local vía sherpa-onnx (Zipformer streaming, español)', () => {
  beforeEach(() => {
    vi.resetModules()
    downloadPinnedFileMock.mockClear()
    acceptWaveformCalls.length = 0
    OnlineRecognizerMock.instances = 0
    nextText = 'ok'
  })

  it('audio vacío: no llega a descargar el modelo, devuelve ""', async () => {
    const { transcribeAudio } = await import('./voice-transcribe')
    expect(await transcribeAudio(new Float32Array(0))).toBe('')
    expect(downloadPinnedFileMock).not.toHaveBeenCalled()
  })

  it('transcribe y recorta el resultado', async () => {
    nextText = '  hola mundo  '
    const { transcribeAudio } = await import('./voice-transcribe')
    const text = await transcribeAudio(new Float32Array([0.1, -0.1, 0.2]))
    expect(text).toBe('hola mundo')
    // los 4 archivos del modelo (encoder/decoder/joiner/tokens), todos desde el mismo repo de Hugging Face
    expect(downloadPinnedFileMock).toHaveBeenCalledTimes(4)
    for (const call of downloadPinnedFileMock.mock.calls) {
      expect(call[0]).toContain('huggingface.co')
      expect(call[4]).toEqual(expect.objectContaining({ onBytes: expect.any(Function) }))
    }
  })

  it('el modelo se carga UNA sola vez aunque se transcriba varias veces seguidas', async () => {
    const { transcribeAudio } = await import('./voice-transcribe')
    await transcribeAudio(new Float32Array([0.1]))
    await transcribeAudio(new Float32Array([0.2]))
    expect(downloadPinnedFileMock).toHaveBeenCalledTimes(4) // no 8: la segunda llamada reusa el recognizer ya cargado
    expect(OnlineRecognizerMock.instances).toBe(1)
  })

  it('un resultado vacío (silencio/nada reconocido) da ""', async () => {
    nextText = ''
    const { transcribeAudio } = await import('./voice-transcribe')
    expect(await transcribeAudio(new Float32Array([0.1]))).toBe('')
  })

  it('recorta el audio a 120 s (16 kHz) antes de mandarlo al modelo — nunca más que eso en una sola llamada', async () => {
    const { transcribeAudio } = await import('./voice-transcribe')
    const long = new Float32Array(16_000 * 200) // 200 s, por encima del tope
    await transcribeAudio(long)
    expect(acceptWaveformCalls[0].samples.length).toBe(16_000 * 120)
  })

  it('manda una cola de silencio después del audio real (el modelo necesita margen para terminar de emitir las últimas palabras)', async () => {
    const { transcribeAudio } = await import('./voice-transcribe')
    await transcribeAudio(new Float32Array(1600))
    expect(acceptWaveformCalls).toHaveLength(2)
    expect(acceptWaveformCalls[1].samples.every((v) => v === 0)).toBe(true)
    expect(acceptWaveformCalls[1].samples.length).toBeGreaterThan(16_000) // más de 1 s de cola
  })

  it('si falla la descarga la primera vez (p.ej. sin red), el próximo intento reintenta en vez de quedar pegado al error', async () => {
    downloadPinnedFileMock.mockRejectedValueOnce(new Error('sin red'))
    const { transcribeAudio } = await import('./voice-transcribe')
    await expect(transcribeAudio(new Float32Array([0.1]))).rejects.toThrow('sin red')
    expect(await transcribeAudio(new Float32Array([0.1]))).toBe('ok')
    expect(OnlineRecognizerMock.instances).toBe(1) // el intento fallido nunca llegó a construir el recognizer
  })

  it('onVoiceModelProgress: avisa mientras se descarga el modelo, y termina con "ready"', async () => {
    const { transcribeAudio, onVoiceModelProgress } = await import('./voice-transcribe')
    const updates: Array<{ status: string; progress: number }> = []
    const off = onVoiceModelProgress((p) => updates.push(p))
    await transcribeAudio(new Float32Array([0.1]))
    expect(updates.length).toBeGreaterThan(0)
    expect(updates.slice(0, -1).every((u) => u.status === 'downloading' && u.progress <= 99)).toBe(true)
    expect(updates.at(-1)).toEqual({ status: 'ready', progress: 100 })
    off()
  })

  it('onVoiceModelProgress: la des-suscripción de verdad deja de avisar', async () => {
    const { transcribeAudio, onVoiceModelProgress } = await import('./voice-transcribe')
    const updates: unknown[] = []
    const off = onVoiceModelProgress((p) => updates.push(p))
    off()
    await transcribeAudio(new Float32Array([0.1]))
    expect(updates).toEqual([])
  })
})
