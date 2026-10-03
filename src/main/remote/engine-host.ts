/**
 * Ensambla el motor del celular (F0-T4): registro de motores, ámbito, proxy por dispositivo, concentrador de eventos y el
 * `EventLog` que vive entre conexiones. El servicio (`service.ts`) solo ve la interfaz `RemoteEngineHost`.
 *
 * La interfaz de confirmación (diálogo, PIN) es de T6: se inyecta con `confirm`. Sin ella se usa un respaldo que RECHAZA
 * toda acción peligrosa (D): sin una UI que pida permiso al dueño, nada que requiera confirmar se ejecuta.
 */
import { EventLog, type MuxDispatch } from '@shared/remote/mux'
import type { OpencodeConnection } from '@shared/types'
import { ConfirmQueue } from './confirm-queue'
import { EngineProxy, type EngineShared, type InvokeFn } from './engine-proxy'
import { EngineRegistry } from './engine-registry'
import { EngineKnowledge, ScopeProvider, type ScopeData } from './engine-scope'
import { SseHub, type SseHubOptions } from './sse-hub'

export interface DeviceDispatch extends MuxDispatch {
  dispose(): void
}

export interface RemoteEngineHost {
  /** Búfer de eventos (sobrevive a las conexiones: permite `sub{since}`). */
  readonly events: EventLog
  readonly hub: SseHub
  readonly registry: EngineRegistry
  /** Despachador de un dispositivo ya autenticado. */
  createDispatch(device: { id: string; name: string }): DeviceDispatch
  /** «Cortar todo» / apagado: cierra streams, caduca los tokens de motor y rechaza lo pendiente de confirmar. */
  close(): void
}

export interface EngineHostOptions {
  getMain: () => Promise<OpencodeConnection>
  loadScope: () => Promise<ScopeData>
  invoke: InvokeFn
  open: SseHubOptions['open']
  subscribeBus?: SseHubOptions['subscribeBus']
  confirm?: ConfirmQueue
  fetch?: typeof fetch
  events?: EventLog
  backoffMs?: number
}

/** Respaldo sin UI: cada confirmación se rechaza en cuanto se presenta. */
export function createRejectingConfirm(): ConfirmQueue {
  const q: ConfirmQueue = new ConfirmQueue({
    ui: {
      present: (info) => {
        queueMicrotask(() => q.resolve(info.requestId, false))
      },
      dismiss: () => undefined
    }
  })
  return q
}

export function createEngineHost(o: EngineHostOptions): RemoteEngineHost {
  const events = o.events ?? new EventLog()
  const registry = new EngineRegistry({ getMain: o.getMain })
  const scope = new ScopeProvider(o.loadScope)
  const knowledge = new EngineKnowledge()
  const confirm = o.confirm ?? createRejectingConfirm()
  const trim = { registry, scope, knowledge }
  const hub = new SseHub({
    log: events,
    registry,
    trim,
    open: o.open,
    subscribeBus: o.subscribeBus,
    backoffMs: o.backoffMs
  })
  const shared: EngineShared = {
    registry,
    scope,
    knowledge,
    confirm,
    invoke: o.invoke,
    events,
    fetch: o.fetch,
    onSub: (eng) => hub.ensure(eng)
  }
  return {
    events,
    hub,
    registry,
    createDispatch: (device) => new EngineProxy(shared, device),
    close: () => {
      hub.stop()
      registry.clear()
      confirm.cancelAll()
    }
  }
}
