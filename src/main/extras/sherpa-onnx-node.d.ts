/**
 * `sherpa-onnx-node` no publica sus propios tipos (ver `node_modules/sherpa-onnx-node/*.js`, puro
 * JSDoc) — esta declaración cubre SOLO la parte de la API que usa `voice-transcribe.ts`
 * (reconocimiento en streaming con un modelo transducer/Zipformer), no el resto del paquete.
 */
declare module 'sherpa-onnx-node' {
  export interface OnlineRecognizerConfig {
    featConfig?: { sampleRate?: number; featureDim?: number }
    modelConfig: {
      transducer: { encoder: string; decoder: string; joiner: string }
      tokens: string
      numThreads?: number
      provider?: string
      modelType?: string
    }
    decodingMethod?: string
    enableEndpoint?: boolean
  }

  export interface OnlineRecognizerResult {
    text: string
  }

  export class OnlineStream {
    acceptWaveform(input: { samples: Float32Array; sampleRate: number }): void
    inputFinished(): void
  }

  export class OnlineRecognizer {
    constructor(config: OnlineRecognizerConfig)
    createStream(): OnlineStream
    isReady(stream: OnlineStream): boolean
    decode(stream: OnlineStream): void
    getResult(stream: OnlineStream): OnlineRecognizerResult
  }
}
