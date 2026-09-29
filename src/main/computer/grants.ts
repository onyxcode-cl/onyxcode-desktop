/**
 * Concesión de "computer use" POR APLICACIÓN (AUDIT/03-motor-interno.md Bloque C, ítem 9).
 *
 * Antes de esta pieza, "Acceso total" era todo o nada: el agente podía actuar sobre cualquier
 * ventana del Mac. Ahora cada app tiene un nivel:
 *   - 'view'  ("Solo ver")     — aparece en las capturas; ninguna acción de ratón/teclado.
 *   - 'click' ("Ver y clic")   — clic y scroll; nada de teclear, teclas ni arrastrar.
 *   - 'full'  ("Control total")— todo, incluida la escritura.
 * Una app sin concesión ni denegación es "desconocida": toda acción sobre ella se rechaza y el
 * error le dice al modelo que llame a `request_access`. `mcp-server.ts` aplica el nivel antes de
 * CADA acción (frontmost y, en clics, la app bajo el punto); este módulo solo persiste el estado.
 *
 * Persistencia: `userData/computer-grants.json` (por app, identificada por bundle id; el nombre se
 * guarda solo para mostrarlo en Ajustes). Editable desde la lista de permisos de Cowork.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { AppGrant, AppTier, GrantsSnapshot } from '@shared/ipc-cowork'
import { APP_ID } from '@shared/brand'

export type { AppGrant, AppTier, GrantsSnapshot }

interface StoreShape {
  grants: Record<string, AppGrant>
  denied: string[]
}

/** Categorías de apps con nivel por defecto más restrictivo (heurística por nombre / bundle id). */
const VIEW_ONLY_PATTERNS: RegExp[] = [
  // Navegadores
  /^com\.apple\.safari/i,
  /^com\.google\.chrome/i,
  /^org\.mozilla\.firefox/i,
  /^com\.microsoft\.edgemac/i,
  /^com\.brave\.browser/i,
  /^company\.thebrowser\.browser/i, // Arc
  /^com\.operasoftware\.opera/i,
  /^com\.vivaldi\.vivaldi/i,
  /^com\.duckduckgo/i,
  // Banca / trading / cripto (nombre, ya que el bundle id varía mucho)
  /banc|bank|trading|broker|invest|crypto|coinbase|binance|kraken|wallet|exchange/i
]

const CLICK_ONLY_PATTERNS: RegExp[] = [
  /^com\.apple\.terminal/i,
  /^com\.googlecode\.iterm2/i,
  /^dev\.warp\.warp-stable/i,
  /^com\.github\.wez\.wezterm/i,
  /^io\.alacritty/i,
  /^com\.microsoft\.vscode/i,
  /^com\.todesktop\.230313mzl4w4u92/i, // Cursor
  /^com\.jetbrains\./i,
  /^com\.apple\.scripteditor2/i,
  /^com\.apple\.automator/i,
  /^com\.apple\.shortcuts/i,
  /^com\.apple\.dt\.xcode/i
]

function matches(patterns: RegExp[], bundleId: string, name: string): boolean {
  return patterns.some((re) => re.test(bundleId) || re.test(name))
}

/**
 * Apps de sistema y la propia OnyxCode: NUNCA pasan por la concesión por app (ni bloquean cmd+space,
 * ni aparecen en tarjetas `request_access`, ni se excluyen de las capturas). Sin esto, OnyxCode podía
 * bloquearse a sí misma cuando quedaba en primer plano (p.ej. tras `cmd+space`) y el agente perdía
 * el Spotlight que acababa de abrir. `com.github.Electron` es el bundle id del propio Electron
 * cuando la app corre sin empaquetar (`npm run dev`).
 */
export const SYSTEM_EXEMPT_BUNDLE_IDS: ReadonlySet<string> = new Set([
  APP_ID,
  'com.github.Electron',
  'com.apple.dock',
  'com.apple.systemuiserver',
  'com.apple.Spotlight',
  'com.apple.controlcenter',
  'com.apple.WindowServer',
  'com.apple.loginwindow',
  'com.apple.notificationcenterui'
])

export function isSystemExempt(bundleId: string): boolean {
  return SYSTEM_EXEMPT_BUNDLE_IDS.has(bundleId)
}

/**
 * Nivel por defecto AUTOASIGNADO la primera vez que se ve la app (sin preguntar): navegadores y
 * apps de banca/trading → "Solo ver"; terminales/IDEs → "Ver y clic". Cualquier otra app devuelve
 * null: no se autoasigna nada, hay que PREGUNTAR con `request_access` (o concederla a mano en
 * Ajustes). El usuario siempre puede subir o bajar el nivel después.
 */
export function defaultTierFor(bundleId: string, name: string): AppTier | null {
  if (matches(VIEW_ONLY_PATTERNS, bundleId, name)) return 'view'
  if (matches(CLICK_ONLY_PATTERNS, bundleId, name)) return 'click'
  return null
}

export class ComputerGrantsStore {
  private data: StoreShape = { grants: {}, denied: [] }
  private loaded = false

  constructor(private readonly file: string) {}

  private load(): void {
    if (this.loaded) return
    this.loaded = true
    try {
      if (existsSync(this.file)) {
        const raw = JSON.parse(readFileSync(this.file, 'utf8')) as Partial<StoreShape>
        if (raw && typeof raw === 'object') {
          this.data.grants = raw.grants && typeof raw.grants === 'object' ? raw.grants : {}
          this.data.denied = Array.isArray(raw.denied) ? raw.denied.filter((d) => typeof d === 'string') : []
        }
      }
    } catch (err) {
      console.error('[computer] leyendo computer-grants.json:', err)
    }
  }

  private persist(): void {
    try {
      mkdirSync(dirname(this.file), { recursive: true })
      writeFileSync(this.file, JSON.stringify(this.data, null, 2), 'utf8')
    } catch (err) {
      console.error('[computer] guardando computer-grants.json:', err)
    }
  }

  snapshot(): GrantsSnapshot {
    this.load()
    return { grants: Object.values(this.data.grants), denied: [...this.data.denied] }
  }

  /** Nivel concedido, o null si es desconocida o está denegada. No autoasigna (a diferencia de `resolve`). */
  tierFor(bundleId: string): AppTier | null {
    this.load()
    if (this.data.denied.includes(bundleId)) return null
    return this.data.grants[bundleId]?.tier ?? null
  }

  /**
   * Nivel concedido, autoasignando el de su categoría (navegador/banca → 'view', terminal/IDE →
   * 'click') la primera vez que se ve una app de esas categorías, para no tener que preguntar por
   * apps ya clasificadas como sensibles. El resto de apps devuelve null hasta que el usuario
   * responda a una tarjeta `request_access` (o las conceda a mano en Ajustes).
   */
  resolve(bundleId: string, name: string): AppTier | null {
    if (isSystemExempt(bundleId)) return 'full'
    this.load()
    if (this.data.denied.includes(bundleId)) return null
    const existing = this.data.grants[bundleId]
    if (existing) return existing.tier
    const def = defaultTierFor(bundleId, name)
    if (def) return this.grant(bundleId, name, def).tier
    return null
  }

  isDenied(bundleId: string): boolean {
    this.load()
    return this.data.denied.includes(bundleId)
  }

  /**
   * Fija el nivel de una app (sobrescribe, sin comparar con el anterior) y la saca de denegadas.
   * Las tarjetas `request_access` NO deben bajar un nivel: `service.resolveAccessRequest` calcula
   * `maxTier(tierFor(b), decisión)` ANTES de llamar aquí; bajar solo es posible desde Ajustes.
   */
  grant(bundleId: string, name: string, tier: AppTier): AppGrant {
    this.load()
    this.data.denied = this.data.denied.filter((d) => d !== bundleId)
    const g: AppGrant = { bundleId, name, tier, grantedAt: Date.now() }
    this.data.grants[bundleId] = g
    this.persist()
    return g
  }

  revoke(bundleId: string): void {
    this.load()
    if (!(bundleId in this.data.grants)) return
    delete this.data.grants[bundleId]
    this.persist()
  }

  /**
   * Borra la concesión y la mete en denegadas. Solo lo dispara una decisión EXPLÍCITA "Denegar" por
   * app (o Ajustes): cancelar una tarjeta (Esc, ✕, "Cancelar") NUNCA llama aquí ni toca concesiones.
   */
  deny(bundleId: string): void {
    this.load()
    delete this.data.grants[bundleId]
    if (!this.data.denied.includes(bundleId)) this.data.denied.push(bundleId)
    this.persist()
  }

  undeny(bundleId: string): void {
    this.load()
    if (!this.data.denied.includes(bundleId)) return
    this.data.denied = this.data.denied.filter((d) => d !== bundleId)
    this.persist()
  }
}
