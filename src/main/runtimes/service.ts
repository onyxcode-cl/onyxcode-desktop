/**
 * Servicio de los runtimes de la app (Node.js y uv, F8-B195): estado, instalación bajo demanda (el botón o la preparación inicial ES
 * el consentimiento; el texto avisa qué se descarga y de dónde), quitar, y las rutas ABSOLUTAS que usan los conectores locales.
 * La lógica y sus pruebas viven en `runtime-install.ts`; aquí solo se cablea Electron (`userData`, `net`, el registro de problemas).
 */
import { app, net } from 'electron'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { RuntimesInstallResult, RuntimesSnapshot } from '@shared/runtimes'
import { LOCAL_CATALOG } from '@shared/mcp-catalog'
import { describeError, recordProblem } from '../diagnostics/problem-log'
import { createManualFetch, type NetLike } from '../remote/tunnel/manual-fetch'
import { unpacked } from '../util/asar'
import { parseRuntimePin, type RuntimePin } from './runtime-pin'
import {
  appRuntimeBins,
  cleanStaleTemp,
  installRuntimes,
  removeRuntimes,
  runtimesStatus,
  RuntimeError,
  type AppRuntimeBins,
  type RuntimeDeps,
  type RuntimeState
} from './runtime-install'

/** ¿Esta plataforma ofrece algún conector local? (si no, los runtimes no se ofrecen ni se descargan). */
export function runtimesOffered(platform: string = process.platform): boolean {
  return LOCAL_CATALOG.some((i) => i.runtime.platforms.includes(platform))
}

export function loadRuntimePin(path: string): RuntimePin | null {
  try {
    return parseRuntimePin(JSON.parse(readFileSync(path, 'utf8')))
  } catch {
    return null
  }
}

const uiState = (s: RuntimeState): 'installed' | 'missing' | 'broken' | 'unsupported' => s.state

class RuntimesService {
  private installing: AbortController | null = null
  private progress: RuntimesSnapshot['progress']
  private error: string | undefined
  private pin: RuntimePin | null | undefined

  deps(): RuntimeDeps {
    if (this.pin === undefined) this.pin = loadRuntimePin(unpacked(join(app.getAppPath(), 'resources', 'runtimes', 'pin.json')))
    return {
      runtimesDir: join(app.getPath('userData'), 'runtimes'),
      pin: this.pin,
      // La pila de red de Electron (proxy del sistema, certificados del Llavero); cada salto lo revisa `pinnedDownload`.
      fetch: createManualFetch(net as unknown as NetLike)
    }
  }

  /** Estado en disco (sin red). */
  check(): ReturnType<typeof runtimesStatus> {
    return runtimesStatus(this.deps())
  }

  /** Rutas absolutas de lo instalado por la app (para los conectores locales). */
  bins(): AppRuntimeBins {
    return appRuntimeBins(this.deps())
  }

  snapshot(): RuntimesSnapshot {
    const offered = runtimesOffered()
    const st = this.check()
    const version = (id: 'node' | 'uv'): string => this.deps().pin?.[id].version ?? ''
    return {
      offered: offered && !st.unsupported,
      items: [
        { id: 'node', state: uiState(st.node), version: version('node') },
        { id: 'uv', state: uiState(st.uv), version: version('uv') }
      ],
      missingBytes: st.missingBytes,
      ready: st.ready,
      installing: this.installing !== null,
      progress: this.installing ? this.progress : undefined,
      error: this.error
    }
  }

  async installNow(): Promise<RuntimesInstallResult> {
    if (this.installing) return { ok: false, error: 'busy', message: 'Ya hay una instalación en curso' }
    this.error = undefined
    const ac = new AbortController()
    this.installing = ac
    try {
      await installRuntimes(this.deps(), (p) => (this.progress = { phase: p.phase, done: p.done, total: p.total }), ac.signal)
      return { ok: true }
    } catch (e) {
      const code = e instanceof RuntimeError ? e.code : 'io'
      this.error = code
      if (code !== 'cancelled') {
        const { message, stack } = describeError(e)
        recordProblem({
          source: 'main',
          level: 'warn',
          message: `Node.js y uv: no se pudieron preparar (${code})`,
          stack,
          detail: { codigo: code, mensaje: message.slice(0, 300), plataforma: process.platform, arquitectura: process.arch }
        })
      }
      return { ok: false, error: code, message: e instanceof Error ? e.message : String(e) }
    } finally {
      this.installing = null
      this.progress = undefined
    }
  }

  cancel(): void {
    this.installing?.abort()
  }

  async remove(): Promise<void> {
    if (this.installing) return
    this.error = undefined
    await removeRuntimes(this.deps().runtimesDir)
  }

  /** Al arrancar: borra temporales abandonados. Nunca lanza. */
  async cleanup(): Promise<void> {
    await cleanStaleTemp(this.deps().runtimesDir)
  }
}

let instance: RuntimesService | null = null
export const runtimesService = (): RuntimesService => (instance ??= new RuntimesService())
