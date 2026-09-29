/**
 * Preferencias y listas del navegador integrado (Lote D, B.2.6): `userData/embedded-browser.json`.
 * `{ version: 1, prefs: { agentEnabled: { code, cowork } }, sites: { code: [], cowork: [] },
 *   denied: { code: [], cowork: [] }, localOrigins: [] }`.
 *
 * `isLocalOriginApproved` es LOAD-BEARING: la lee `session.ts` en cada petición de red
 * (`webRequest.onBeforeRequest`), así que el estado vive en memoria (cache) y la escritura a
 * disco es atómica pero no bloquea la lectura.
 */
import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { BrowserSite } from '@shared/ipc-cowork'
import type { BrowserPrefs, BrowserProduct } from '@shared/ipc-browser'

interface StoreShape {
  version: 1
  prefs: BrowserPrefs
  sites: Record<BrowserProduct, BrowserSite[]>
  denied: Record<BrowserProduct, string[]>
  localOrigins: string[]
}

function defaultStore(): StoreShape {
  return {
    version: 1,
    // Decisión del usuario (docs/LOTE-D-PLAN.md, «Decisiones del usuario» #2, 2026-09-28): el
    // navegador del agente empieza APAGADO en Code y en Cowork, como el antiguo
    // «Chrome aparte» (eliminado); se activa a mano en Ajustes. El esqueleto
    // original de B.4/D1 paso 6 traía `true/true`: corregido en D5 al detectar que contradecía la
    // decisión final del usuario (ver `docs/LOTE-D.md` §2 y `AUDIT.md` §11).
    prefs: { agentEnabled: { code: false, cowork: false } },
    sites: { code: [], cowork: [] },
    denied: { code: [], cowork: [] },
    localOrigins: []
  }
}

let filePathCache: string | null = null
function storeFile(): string {
  if (!filePathCache) filePathCache = join(app.getPath('userData'), 'embedded-browser.json')
  return filePathCache
}

function normalizeSiteList(v: unknown): BrowserSite[] {
  if (!Array.isArray(v)) return []
  const out: BrowserSite[] = []
  for (const item of v) {
    if (!item || typeof item !== 'object') continue
    const rec = item as Record<string, unknown>
    if (typeof rec.site !== 'string' || !rec.site) continue
    out.push({ site: rec.site.toLowerCase(), addedAt: typeof rec.addedAt === 'number' ? rec.addedAt : Date.now() })
  }
  return out
}

function normalizeStringList(v: unknown): string[] {
  if (!Array.isArray(v)) return []
  return [...new Set(v.filter((x): x is string => typeof x === 'string'))]
}

function normalize(raw: unknown): StoreShape {
  const base = defaultStore()
  if (!raw || typeof raw !== 'object') return base
  const o = raw as Record<string, unknown>
  const prefsRaw = o.prefs && typeof o.prefs === 'object' ? (o.prefs as Record<string, unknown>) : {}
  const agentRaw =
    prefsRaw.agentEnabled && typeof prefsRaw.agentEnabled === 'object' ? (prefsRaw.agentEnabled as Record<string, unknown>) : {}
  const sitesRaw = o.sites && typeof o.sites === 'object' ? (o.sites as Record<string, unknown>) : {}
  const deniedRaw = o.denied && typeof o.denied === 'object' ? (o.denied as Record<string, unknown>) : {}
  return {
    version: 1,
    prefs: {
      agentEnabled: {
        code: typeof agentRaw.code === 'boolean' ? agentRaw.code : base.prefs.agentEnabled.code,
        cowork: typeof agentRaw.cowork === 'boolean' ? agentRaw.cowork : base.prefs.agentEnabled.cowork
      }
    },
    sites: { code: normalizeSiteList(sitesRaw.code), cowork: normalizeSiteList(sitesRaw.cowork) },
    denied: { code: normalizeStringList(deniedRaw.code), cowork: normalizeStringList(deniedRaw.cowork) },
    localOrigins: normalizeStringList(o.localOrigins)
  }
}

let cache: StoreShape | null = null

function load(): StoreShape {
  if (cache) return cache
  let raw: unknown = null
  try {
    if (existsSync(storeFile())) raw = JSON.parse(readFileSync(storeFile(), 'utf8'))
  } catch (err) {
    console.error('[embedded-browser] embedded-browser.json inválido, usando valores por defecto:', err)
  }
  cache = normalize(raw)
  return cache
}

function persist(): void {
  const data = load()
  mkdirSync(dirname(storeFile()), { recursive: true })
  const tmp = `${storeFile()}.tmp`
  writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8')
  renameSync(tmp, storeFile())
}

export function getPrefs(): BrowserPrefs {
  return { agentEnabled: { ...load().prefs.agentEnabled } }
}

export function setPrefs(patch: { agentEnabled?: Partial<BrowserPrefs['agentEnabled']> }): BrowserPrefs {
  const cur = load()
  cur.prefs.agentEnabled = { ...cur.prefs.agentEnabled, ...(patch.agentEnabled ?? {}) }
  persist()
  return getPrefs()
}

export function sitesFor(product: BrowserProduct): BrowserSite[] {
  return [...load().sites[product]]
}

export function isSiteAllowed(product: BrowserProduct, site: string): boolean {
  const s = site.toLowerCase()
  return load().sites[product].some((x) => x.site === s)
}

export function addSite(product: BrowserProduct, site: string): void {
  const cur = load()
  const s = site.toLowerCase()
  if (!cur.sites[product].some((x) => x.site === s)) cur.sites[product].push({ site: s, addedAt: Date.now() })
  cur.denied[product] = cur.denied[product].filter((x) => x !== s)
  persist()
}

export function removeSite(product: BrowserProduct, site: string): void {
  const cur = load()
  const s = site.toLowerCase()
  cur.sites[product] = cur.sites[product].filter((x) => x.site !== s)
  persist()
}

export function deniedFor(product: BrowserProduct): string[] {
  return [...load().denied[product]]
}

export function isSiteDenied(product: BrowserProduct, site: string): boolean {
  return load().denied[product].includes(site.toLowerCase())
}

export function denySite(product: BrowserProduct, site: string): void {
  const cur = load()
  const s = site.toLowerCase()
  if (!cur.denied[product].includes(s)) cur.denied[product].push(s)
  persist()
}

export function undenySite(product: BrowserProduct, site: string): void {
  const cur = load()
  const s = site.toLowerCase()
  cur.denied[product] = cur.denied[product].filter((x) => x !== s)
  persist()
}

export function localOrigins(): string[] {
  return [...load().localOrigins]
}

/** LOAD-BEARING: la consulta `session.ts` en cada petición de red hacia un destino local. */
export function isLocalOriginApproved(origin: string): boolean {
  return load().localOrigins.includes(origin)
}

export function approveLocalOrigin(origin: string): void {
  const cur = load()
  if (!cur.localOrigins.includes(origin)) cur.localOrigins.push(origin)
  persist()
}

export function removeLocalOrigin(origin: string): void {
  const cur = load()
  cur.localOrigins = cur.localOrigins.filter((x) => x !== origin)
  persist()
}

/** «Borrar datos» (B.10): reinicia las listas de sitios/denegados del producto (no las cookies). */
export function clearProductData(product: BrowserProduct): void {
  const cur = load()
  cur.sites[product] = []
  cur.denied[product] = []
  persist()
}
