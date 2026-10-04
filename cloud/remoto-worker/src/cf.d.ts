/**
 * Tipos mínimos PROPIOS de lo que usa el Worker (sin `@cloudflare/workers-types`: no se añade ninguna dependencia).
 * Solo describen la parte de la API de Workers/Durable Objects que se toca aquí.
 */
export {}

declare global {
  interface DurableObjectId {
    toString(): string
  }
  interface DurableObjectStub {
    fetch(request: Request): Promise<Response>
  }
  interface DurableObjectNamespace {
    idFromName(name: string): DurableObjectId
    get(id: DurableObjectId): DurableObjectStub
  }
  /** WebSocket de Workers con adjuntos (sobreviven a la hibernación). */
  interface DurableSocket extends WebSocket {
    serializeAttachment(value: unknown): void
    deserializeAttachment(): unknown
  }
  class WebSocketPair {
    0: WebSocket
    1: DurableSocket
  }
  class WebSocketRequestResponsePair {
    constructor(request: string, response: string)
  }
  interface DurableObjectState {
    acceptWebSocket(ws: WebSocket): void
    getWebSockets(): DurableSocket[]
    setWebSocketAutoResponse(pair: WebSocketRequestResponsePair): void
    getWebSocketAutoResponseTimestamp(ws: WebSocket): Date | null
  }
  interface RateLimit {
    limit(opts: { key: string }): Promise<{ success: boolean }>
  }
  interface ResponseInit {
    webSocket?: WebSocket | null
  }
}
