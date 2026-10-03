/**
 * Instala en la página los shims del celular: `window.api` (IPC por el puente) y `window.fetch` (motor OpenCode por el
 * puente). Debe ejecutarse ANTES de cargar la interfaz: `lib/api.ts` lee `window.api` al evaluarse y el SDK v2 llama al
 * `fetch` global en cada petición (por eso no hace falta tocar `lib/opencode.ts`).
 */
import { t, type MsgKey } from '@shared/i18n'
import type { WindowApi } from '@shared/ipc'
import type { LinkErrorCode, RemoteLink } from '@shared/remote/link'
import { createEngineFetch } from './engine-fetch'
import { EventsHub } from './events-hub'
import { installInsecureContextShims } from './insecure-shims'
import { buildRemoteWindowApi } from './ipc-shim'

export interface RemoteRuntime {
  api: WindowApi
  hub: EventsHub
  fetch: typeof fetch
}

const text = (code: LinkErrorCode): string => t(`remote.link.${code}` as MsgKey)

export function installRemoteRuntime(link: RemoteLink, target: Window & typeof globalThis = window): RemoteRuntime {
  installInsecureContextShims(target)
  const hub = new EventsHub(link)
  const api = buildRemoteWindowApi({ link, events: hub, text })
  const orig = target.fetch.bind(target)
  const engineFetch = createEngineFetch({ link, events: hub, text, fallback: orig })
  Object.defineProperty(target, 'api', { value: api, configurable: true, writable: true })
  target.fetch = engineFetch
  return { api, hub, fetch: engineFetch }
}
