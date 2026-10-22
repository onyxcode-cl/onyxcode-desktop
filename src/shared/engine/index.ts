/**
 * Puerta de entrada de la capa del motor. Los consumidores importan de `@shared/engine`:
 * tipos propios, `EngineClient`, `EngineError` y `createEngineClient`. Nunca de `adapters/` ni del SDK.
 */
export * from './types'
export * from './events'
export * from './errors'
export * from './client'
export { createEngineClient } from './factory'
export type { CreateEngineClientOptions, EngineVersion } from './factory'
