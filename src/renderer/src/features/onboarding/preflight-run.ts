/**
 * Instalación de lo que falta en la pantalla «Preparando Lazunox», sin React ni IPC directo (se prueba con `preflight-run.test.ts`).
 * Instala en el orden del plan (ArtCraft, Node.js y uv, y luego el entorno aislado), informa el avance de cada componente y, si uno falla, anota el
 * motivo real y sigue con el resto: cada componente es independiente.
 */
import type { PreflightId, Runtime } from '@shared/preflight'
import { installFailureCode } from '../settings/impl/component-install'

export interface InstallApi {
  /** `craft:install`: resuelve al terminar (con éxito o con el código del fallo). `undefined` = el IPC ni respondió. */
  craftInstall: () => Promise<{ ok: boolean; error?: string; message?: string } | undefined>
  /** Porcentaje real de la descarga de ArtCraft (de `craft:status`), o `null` si aún no se conoce. */
  craftProgress: () => Promise<number | null>
  /** `runtimes:install` (Node.js y uv, F8-B195): resuelve al terminar, con éxito o con el código del fallo. */
  runtimesInstall: () => Promise<{ ok: boolean; error?: string; message?: string } | undefined>
  /** Porcentaje real de la descarga de Node.js y uv (de `runtimes:status`), o `null`. */
  runtimesProgress: () => Promise<number | null>
  /** `tasks:sandbox:setup`: devuelve enseguida; la instalación sigue en main. */
  sandboxSetup: () => Promise<unknown>
  sandboxStatus: () => Promise<{ state: string; setup: { running: boolean; pct: number; error?: string } | null }>
  /** `preflight:fail`: anota el fallo en el registro de problemas y devuelve el detalle redactado. */
  fail: (id: PreflightId, code: string | undefined, message: string | undefined) => Promise<{ detail: string } | null>
  sleep: (ms: number) => Promise<void>
  alive: () => boolean
}

export interface InstallEvents {
  onRuntime: (id: PreflightId, rt: Runtime | null) => void
  onDetail: (id: PreflightId, detail: string) => void
}

export interface InstallOutcome {
  id: PreflightId
  ok: boolean
  /** Código del fallo (`disk`, `hash`, `offline`…). */
  code?: string
  /** Mensaje técnico de main (se redacta antes de copiarlo). */
  message?: string
}

export const CRAFT_POLL_MS = 1000
export const SANDBOX_POLL_MS = 1500
/** Tope de sondeos del entorno aislado (≈ 1,7 h): si main nunca termina, no se espera para siempre. */
export const SANDBOX_MAX_POLLS = 4000

async function installCraft(api: InstallApi, ev: InstallEvents): Promise<InstallOutcome> {
  let result: Awaited<ReturnType<InstallApi['craftInstall']>>
  let settled = false
  const run = api
    .craftInstall()
    .catch(() => undefined)
    .then((r) => {
      result = r
      settled = true
    })
  while (!settled && api.alive()) {
    const pct = await api.craftProgress().catch(() => null)
    if (!settled) ev.onRuntime('craft', { state: 'downloading', ...(pct !== null ? { pct } : {}) })
    await Promise.race([run, api.sleep(CRAFT_POLL_MS)])
  }
  await run
  if (result?.ok) return { id: 'craft', ok: true }
  const code = installFailureCode(result)
  return { id: 'craft', ok: false, code, message: result?.message }
}

async function installRuntimes(api: InstallApi, ev: InstallEvents): Promise<InstallOutcome> {
  let result: Awaited<ReturnType<InstallApi['runtimesInstall']>>
  let settled = false
  const run = api
    .runtimesInstall()
    .catch(() => undefined)
    .then((r) => {
      result = r
      settled = true
    })
  while (!settled && api.alive()) {
    const pct = await api.runtimesProgress().catch(() => null)
    if (!settled) ev.onRuntime('runtimes', { state: 'downloading', ...(pct !== null ? { pct } : {}) })
    await Promise.race([run, api.sleep(CRAFT_POLL_MS)])
  }
  await run
  if (result?.ok) return { id: 'runtimes', ok: true }
  return { id: 'runtimes', ok: false, code: installFailureCode(result), message: result?.message }
}

async function installSandbox(api: InstallApi, ev: InstallEvents): Promise<InstallOutcome> {
  await api.sandboxSetup().catch(() => undefined)
  for (let i = 0; i < SANDBOX_MAX_POLLS && api.alive(); i++) {
    const s = await api.sandboxStatus().catch(() => null)
    if (s?.setup?.running) {
      ev.onRuntime('sandbox', { state: 'downloading', pct: s.setup.pct })
      await api.sleep(SANDBOX_POLL_MS)
      continue
    }
    if (s?.state === 'ready') return { id: 'sandbox', ok: true }
    return { id: 'sandbox', ok: false, code: s?.setup?.error ?? 'generic' }
  }
  return { id: 'sandbox', ok: false, code: 'generic' }
}

/** Instala `ids` en orden. Devuelve el resultado de cada uno; los fallos ya quedaron anotados y con su detalle. */
export async function runInstall(ids: readonly PreflightId[], api: InstallApi, ev: InstallEvents): Promise<InstallOutcome[]> {
  const out: InstallOutcome[] = []
  for (const id of ids) {
    if (!api.alive()) break
    ev.onRuntime(id, { state: 'downloading' })
    const r: InstallOutcome =
      id === 'craft'
        ? await installCraft(api, ev)
        : id === 'runtimes'
          ? await installRuntimes(api, ev)
          : id === 'sandbox'
            ? await installSandbox(api, ev)
            : { id, ok: false, code: 'unsupported' }
    out.push(r)
    if (r.ok) ev.onRuntime(id, null)
    else {
      ev.onRuntime(id, { state: 'failed', error: r.code })
      const d = await api.fail(id, r.code, r.message).catch(() => null)
      if (d) ev.onDetail(id, d.detail)
    }
  }
  return out
}
