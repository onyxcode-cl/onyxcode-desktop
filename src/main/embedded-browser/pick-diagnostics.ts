/**
 * Errores de consola y de red de UNA pestaña desde que se activa «Seleccionar elemento» (F8-B71).
 *
 * Solo escucha EVENTOS CDP (`Runtime.consoleAPICalled`, `Runtime.exceptionThrown`, `Log.entryAdded`, `Network.*`): no usa ningún
 * método nuevo, así que `ALLOWED_CDP` no cambia (`Runtime.enable`, `Log.enable` y `Network.enable` ya estaban). Es independiente
 * de los búferes de `tools.ts` (esos solo se llenan cuando el agente pide una herramienta de diagnóstico y sirven a otro fin).
 *
 * Los datos son crudos: `pick.ts` (`sanitizeDiagnostics`) los limpia (sin query, sin secretos, con topes) antes de salir.
 */
import type { CdpSession } from './api'
import { PICK_LIMITS } from '@shared/ipc-browser'
import type { RawDiagnostics } from './pick'

export interface DiagnosticsCollector {
  /** Lo recogido hasta ahora (últimas `diagEntries` de cada lista) y los ms transcurridos desde `start`. */
  snapshot(): RawDiagnostics
  /** Quita los oyentes. Es seguro llamarlo varias veces. */
  dispose(): void
}

const MAX_PENDING = 200

interface CdpRemoteObject {
  type?: string
  value?: unknown
  description?: string
}

function describeArg(a: CdpRemoteObject): string {
  if (a.value !== undefined && a.value !== null) return typeof a.value === 'string' ? a.value : JSON.stringify(a.value)
  return a.description ?? a.type ?? ''
}

/**
 * Empieza a recoger. Los oyentes se enganchan ANTES de activar los dominios y las entradas anteriores al arranque (`Runtime.enable`
 * reenvía mensajes ya guardados) se descartan por su marca de tiempo.
 */
export async function startDiagnostics(session: CdpSession, now: () => number = Date.now): Promise<DiagnosticsCollector> {
  const startedAt = now()
  const consoleList: { level: string; text: string }[] = []
  const networkList: { method: string; url: string; status?: number; error?: string }[] = []
  const pending = new Map<string, { method: string; url: string }>()
  const offs: (() => void)[] = []

  const keep = <T>(list: T[]): void => {
    if (list.length > PICK_LIMITS.diagEntries * 3) list.splice(0, list.length - PICK_LIMITS.diagEntries * 3)
  }
  const fresh = (ts: unknown): boolean => typeof ts !== 'number' || !Number.isFinite(ts) || ts >= startedAt - 50
  const pushConsole = (level: string, text: string): void => {
    consoleList.push({ level, text })
    keep(consoleList)
  }

  offs.push(
    session.on('Runtime.consoleAPICalled', (p: { type?: string; args?: CdpRemoteObject[]; timestamp?: number }) => {
      if (!fresh(p?.timestamp)) return
      const type = p?.type
      if (type !== 'error' && type !== 'warning' && type !== 'assert') return
      const text = (Array.isArray(p.args) ? p.args : []).map(describeArg).join(' ')
      pushConsole(type === 'warning' ? 'warning' : 'error', text)
    })
  )
  offs.push(
    session.on(
      'Runtime.exceptionThrown',
      (p: { timestamp?: number; exceptionDetails?: { text?: string; exception?: { description?: string } } }) => {
        if (!fresh(p?.timestamp)) return
        const d = p?.exceptionDetails
        pushConsole('error', d?.exception?.description?.split('\n')[0] ?? d?.text ?? 'Uncaught')
      }
    )
  )
  offs.push(
    session.on('Log.entryAdded', (p: { entry?: { level?: string; text?: string; timestamp?: number } }) => {
      const e = p?.entry
      if (!e || !fresh(e.timestamp)) return
      if (e.level === 'error' || e.level === 'warning') pushConsole(e.level, String(e.text ?? ''))
    })
  )
  offs.push(
    session.on('Network.requestWillBeSent', (p: { requestId?: string; request?: { url?: string; method?: string } }) => {
      if (!p?.requestId) return
      pending.set(p.requestId, { method: String(p.request?.method ?? 'GET'), url: String(p.request?.url ?? '') })
      if (pending.size > MAX_PENDING) {
        const first = pending.keys().next().value
        if (first !== undefined) pending.delete(first)
      }
    })
  )
  offs.push(
    session.on('Network.responseReceived', (p: { requestId?: string; response?: { status?: number; url?: string } }) => {
      const status = p?.response?.status
      if (typeof status !== 'number' || status < 400) return
      const req = p.requestId ? pending.get(p.requestId) : undefined
      networkList.push({ method: req?.method ?? 'GET', url: String(p.response?.url ?? req?.url ?? ''), status })
      keep(networkList)
    })
  )
  offs.push(
    session.on('Network.loadingFailed', (p: { requestId?: string; errorText?: string; canceled?: boolean }) => {
      const req = p?.requestId ? pending.get(p.requestId) : undefined
      // Cancelada por la propia página (navegación, abort): no es un fallo.
      if (!req || p.canceled) return
      networkList.push({ method: req.method, url: req.url, error: String(p.errorText ?? 'failed') })
      keep(networkList)
    })
  )

  for (const method of ['Runtime.enable', 'Log.enable', 'Network.enable'] as const) {
    await session.send(method).catch(() => undefined)
  }

  let disposed = false
  return {
    snapshot: () => ({
      console: consoleList.slice(-PICK_LIMITS.diagEntries),
      network: networkList.slice(-PICK_LIMITS.diagEntries),
      sinceMs: Math.max(0, now() - startedAt)
    }),
    dispose: () => {
      if (disposed) return
      disposed = true
      for (const off of offs) off()
      pending.clear()
    }
  }
}
