/**
 * Política de red de Cowork: lista blanca persistida (`userData/tasks-network.json`) que usa
 * `EgressProxy` (`proxy.ts`) para decidir qué hosts puede alcanzar un servidor sandboxeado.
 *
 * Por defecto: el host del proveedor de modelos (necesario para que el agente funcione) y el host
 * de la búsqueda web del agente (`WEB_SEARCH_HOSTS`, interruptor activado por defecto y desactivable).
 * El usuario puede añadir hosts (npm/PyPI con un interruptor, o cualquier otro dominio) desde
 * Ajustes → "Red de Cowork", o al aprobar una tarjeta de bloqueo ("Permitir siempre").
 * Todo lo demás sigue bloqueado por defecto (deny-by-default).
 * "Permitir esta vez" NO se persiste: solo vale para los servidores ya arrancados (en memoria).
 */
import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { NetworkPolicyState, NetworkToggleKey } from '@shared/ipc-cowork'

/** Host de la API de modelos usada por Cowork (OpenCode Go / OpenCode Zen). Ver opencode-config.ts. */
export const PROVIDER_HOST = 'opencode.ai'

export const NPM_HOSTS = ['registry.npmjs.org']
export const PYPI_HOSTS = ['pypi.org', 'files.pythonhosted.org']

/**
 * Hosts de la herramienta `websearch` de OpenCode. En el binario 1.18.32 la herramienta usa
 * `mcp.exa.ai` o `search.parallel.ai` según `hash(sessionID) % 2`, salvo que `OPENCODE_WEBSEARCH_PROVIDER`
 * fije el proveedor: el servidor sandbox lo arranca con `OPENCODE_WEBSEARCH_PROVIDER=exa` para que
 * baste un único host. Reverificar al subir de versión de OpenCode.
 */
export const WEB_SEARCH_HOSTS = ['mcp.exa.ai']

export type { NetworkPolicyState, NetworkToggleKey }

interface Persisted {
  npmEnabled: boolean
  pypiEnabled: boolean
  /** Búsqueda web del agente (activada por defecto). */
  webSearchEnabled: boolean
  custom: string[]
  blocked: string[]
}

const DEFAULTS: Persisted = { npmEnabled: false, pypiEnabled: false, webSearchEnabled: true, custom: [], blocked: [] }

function file(): string {
  return join(app.getPath('userData'), 'tasks-network.json')
}

export class NetworkPolicy {
  private data: Persisted | null = null
  /** Hosts permitidos "solo esta vez" por carpeta (en memoria; se pierden al reiniciar). */
  private once = new Map<string, Set<string>>()

  private load(): Persisted {
    if (this.data) return this.data
    let data = { ...DEFAULTS }
    try {
      const f = file()
      if (existsSync(f)) {
        const raw = JSON.parse(readFileSync(f, 'utf8')) as Partial<Persisted>
        data = {
          npmEnabled: raw.npmEnabled === true,
          pypiEnabled: raw.pypiEnabled === true,
          webSearchEnabled: raw.webSearchEnabled !== false,
          custom: Array.isArray(raw.custom) ? raw.custom.filter((h) => typeof h === 'string') : [],
          blocked: Array.isArray(raw.blocked) ? raw.blocked.filter((h) => typeof h === 'string') : []
        }
      }
    } catch (err) {
      console.error('[tasks] tasks-network.json inválido:', err)
    }
    this.data = data
    return data
  }

  private save(): void {
    const f = file()
    mkdirSync(dirname(f), { recursive: true })
    writeFileSync(`${f}.tmp`, JSON.stringify(this.load(), null, 2), 'utf8')
    renameSync(`${f}.tmp`, f)
  }

  state(): NetworkPolicyState {
    const d = this.load()
    return {
      providerHost: PROVIDER_HOST,
      npmEnabled: d.npmEnabled,
      pypiEnabled: d.pypiEnabled,
      webSearchEnabled: d.webSearchEnabled,
      webSearchHosts: [...WEB_SEARCH_HOSTS],
      custom: [...d.custom],
      blocked: [...d.blocked]
    }
  }

  setToggle(key: NetworkToggleKey, value: boolean): NetworkPolicyState {
    const d = this.load()
    d[key] = value
    this.save()
    return this.state()
  }

  /** "Permitir siempre" / "Mantener bloqueado" para un host concreto (persistido). */
  setHostAlways(host: string, decision: 'allow' | 'block' | 'unset'): NetworkPolicyState {
    const d = this.load()
    const h = host.toLowerCase()
    d.custom = d.custom.filter((x) => x !== h)
    d.blocked = d.blocked.filter((x) => x !== h)
    if (decision === 'allow') d.custom.push(h)
    else if (decision === 'block') d.blocked.push(h)
    this.save()
    return this.state()
  }

  removeCustom(host: string): NetworkPolicyState {
    const d = this.load()
    d.custom = d.custom.filter((x) => x !== host.toLowerCase())
    this.save()
    return this.state()
  }

  /** "Permitir esta vez": solo para los servidores YA arrancados de esa carpeta (no persiste). */
  allowOnce(folder: string, host: string): void {
    const set = this.once.get(folder) ?? new Set<string>()
    set.add(host.toLowerCase())
    this.once.set(folder, set)
  }

  /** ¿Ya hay una concesión temporal para ese host en la carpeta? */
  hasOnce(folder: string, host: string): boolean {
    return this.once.get(folder)?.has(host.toLowerCase()) === true
  }

  /**
   * Retira una concesión temporal (`allowOnce`). Lo usan las rutinas para que los "sitios permitidos"
   * valgan solo mientras dura la ejecución. No toca los hosts permitidos de forma persistente.
   */
  revokeOnce(folder: string, host: string): void {
    const set = this.once.get(folder)
    if (!set) return
    set.delete(host.toLowerCase())
    if (set.size === 0) this.once.delete(folder)
  }

  clearFolder(folder: string): void {
    this.once.delete(folder)
  }

  /** Lista blanca efectiva para el servidor de `folder` en este momento. */
  effectiveAllowlist(folder: string): string[] {
    const d = this.load()
    if (d.blocked.includes(PROVIDER_HOST)) {
      // El proveedor nunca se bloquea de verdad (rompería la tarea); se ignora un "blocked" accidental.
    }
    const list = [PROVIDER_HOST, ...d.custom]
    if (d.npmEnabled) list.push(...NPM_HOSTS)
    if (d.pypiEnabled) list.push(...PYPI_HOSTS)
    if (d.webSearchEnabled) list.push(...WEB_SEARCH_HOSTS)
    for (const h of this.once.get(folder) ?? []) list.push(h)
    return [...new Set(list.map((h) => h.toLowerCase()))].filter((h) => !d.blocked.includes(h) || h === PROVIDER_HOST)
  }
}
