/**
 * Revisión de arranque («Preparando Lazunox»): tipos y lógica PURA de qué componentes tiene que haber, cuáles son esenciales, qué se
 * instala y en qué orden, cuánto se descarga y cuándo hay que mostrar la pantalla. Sin Electron, React ni IPC: la comparten el servicio de
 * main (`src/main/preflight`), la pantalla del renderer y el informe de Diagnóstico (se prueba con `preflight.test.ts`).
 *
 * Esencial = sin eso la app no sirve y se resuelve aquí (motor, ArtCraft, en Windows el entorno aislado, disco y carpeta de datos). No
 * esencial = permisos de macOS, ubicación de la app y ayudante de control: se avisan como «Pendiente» y se puede continuar.
 */

export type PreflightId = 'storage' | 'disk' | 'engine' | 'craft' | 'sandbox' | 'helper' | 'perms' | 'location'

/** Orden en que se muestran y se instalan. */
export const PREFLIGHT_ORDER: readonly PreflightId[] = ['storage', 'disk', 'engine', 'craft', 'sandbox', 'helper', 'perms', 'location']

/** Lo que el botón «Instalar lo que falta» instala, en este orden. El motor viene dentro de la app: no se descarga. */
export const INSTALL_ORDER: readonly PreflightId[] = ['craft', 'sandbox']

/** Tamaño aproximado del entorno aislado de Windows (la distro propia): «unos 2 GB de disco». */
export const SANDBOX_APPROX_BYTES = 2_000_000_000

/** Cuánto espacio libre exige cada componente respecto de lo que descarga (el de ArtCraft = `CRAFT_DISK_FACTOR` de craft-install). */
export const DISK_FACTOR: Partial<Record<PreflightId, number>> = { craft: 4, sandbox: 1 }

export interface PreflightComponent {
  id: PreflightId
  /** Sin esto no se entra a la app. */
  essential: boolean
  ok: boolean
  /** Código corto de por qué no está listo (`not-found`, `incomplete`, `needsSetup`, `accessibility`…); la pantalla lo traduce. */
  reason?: string
  /** Lo arregla el botón «Instalar lo que falta». */
  installable: boolean
  /** Bytes a descargar si falta (solo componentes instalables). */
  sizeBytes?: number
  /** Versión instalada o esperada (informativo). */
  version?: string
  /** Detalle técnico para el informe (piezas dañadas, estado del entorno…). Pasa por el redactor antes de salir de main. */
  detail?: string
}

export interface PreflightReport {
  at: number
  platform: string
  appVersion: string
  components: PreflightComponent[]
  /** Bytes libres en el disco de los datos; `null` si no se pudo leer. */
  freeBytes: number | null
  /** Se saltó (pruebas automáticas): no hay nada que mostrar. */
  skipped?: boolean
}

const rank = (id: PreflightId): number => PREFLIGHT_ORDER.indexOf(id)

/** Componentes en el orden de la pantalla. */
export function ordered(report: PreflightReport): PreflightComponent[] {
  return [...report.components].sort((a, b) => rank(a.id) - rank(b.id))
}

/** Esenciales que no están listos: mientras haya alguno, la pantalla no se puede omitir. */
export function blocking(report: PreflightReport): PreflightComponent[] {
  return ordered(report).filter((c) => c.essential && !c.ok)
}

/** No esenciales pendientes (permisos, ubicación, ayudante): se avisan y se puede continuar. */
export function optionalPending(report: PreflightReport): PreflightComponent[] {
  return ordered(report).filter((c) => !c.essential && !c.ok)
}

/** Lo que instala el botón, en orden: componentes instalables que faltan. */
export function installPlan(report: PreflightReport): PreflightComponent[] {
  return INSTALL_ORDER.map((id) => report.components.find((c) => c.id === id)).filter(
    (c): c is PreflightComponent => c !== undefined && !c.ok && c.installable
  )
}

/** Tamaño aproximado de lo que se va a descargar. */
export function downloadBytes(report: PreflightReport): number {
  return installPlan(report).reduce((n, c) => n + (c.sizeBytes ?? 0), 0)
}

/** Espacio libre necesario para instalar lo que falta (ArtCraft ×4, entorno aislado ×1). */
export function requiredFreeBytes(report: PreflightReport): number {
  return installPlan(report).reduce((n, c) => n + (c.sizeBytes ?? 0) * (DISK_FACTOR[c.id] ?? 1), 0)
}

/** ¿Alcanza el disco? `null` = no se pudo medir (se intenta igual). */
export function diskEnough(freeBytes: number | null, needBytes: number): boolean {
  return freeBytes === null || freeBytes >= needBytes
}

/** El botón «Instalar lo que falta» se puede pulsar: hay algo que instalar y ni la carpeta de datos ni el disco lo impiden. */
export function canInstall(report: PreflightReport): boolean {
  if (installPlan(report).length === 0) return false
  return !report.components.some((c) => (c.id === 'storage' || c.id === 'disk') && !c.ok)
}

/** Estado de un componente tal como se pinta, mezclando la revisión con lo que pasa durante la instalación. */
export type RowState = 'ready' | 'missing' | 'downloading' | 'failed' | 'pending'

export interface Runtime {
  state: 'downloading' | 'failed'
  /** Porcentaje de la descarga (0–100) si se conoce. */
  pct?: number
  /** Código del fallo (`disk`, `hash`, `offline`…). */
  error?: string
}
export type RuntimeMap = Partial<Record<PreflightId, Runtime>>

export function rowState(c: PreflightComponent, rt: RuntimeMap = {}): RowState {
  const r = rt[c.id]
  if (r?.state === 'downloading') return 'downloading'
  if (r?.state === 'failed') return 'failed'
  if (c.ok) return 'ready'
  return c.essential ? 'missing' : 'pending'
}

/** Filas visibles: lo que no está listo y los componentes que se instalan; disco y carpeta de datos solo si fallan. */
export function visibleRows(report: PreflightReport): PreflightComponent[] {
  return ordered(report).filter((c) => !(c.ok && (c.id === 'disk' || c.id === 'storage')))
}

/** ¿Se puede entrar a la app? Solo si no queda nada esencial sin resolver ni en curso. */
export function canContinue(report: PreflightReport, rt: RuntimeMap = {}): boolean {
  return blocking(report).length === 0 && !Object.values(rt).some((r) => r?.state === 'downloading')
}

/** Huella de «Continuar de todos modos»: no se vuelve a mostrar la pantalla por los mismos pendientes en la misma versión de la app. */
export interface Dismissal {
  version: string
  ids: PreflightId[]
}

export function dismissalFor(report: PreflightReport): Dismissal {
  return { version: report.appVersion, ids: optionalPending(report).map((c) => c.id) }
}

function sameDismissal(a: Dismissal, b: Dismissal): boolean {
  return a.version === b.version && a.ids.length === b.ids.length && a.ids.every((id, i) => id === b.ids[i])
}

/**
 * ¿Hay que mostrar la pantalla? Siempre que falte algo esencial. Si solo hay pendientes no esenciales, solo hasta que la persona pulse
 * «Continuar de todos modos» (para esa versión de la app y esos mismos pendientes). Todo listo o revisión omitida = no se muestra nada.
 */
export function shouldShow(report: PreflightReport, dismissed: Dismissal | null): 'blocking' | 'optional' | null {
  if (report.skipped) return null
  if (blocking(report).length > 0) return 'blocking'
  const pending = optionalPending(report)
  if (pending.length === 0) return null
  return dismissed && sameDismissal(dismissed, dismissalFor(report)) ? null : 'optional'
}

/** Lee una huella guardada (JSON de localStorage) con tolerancia a datos rotos. */
export function parseDismissal(raw: string | null): Dismissal | null {
  if (!raw) return null
  try {
    const o = JSON.parse(raw) as Partial<Dismissal> | null
    if (!o || typeof o.version !== 'string' || !Array.isArray(o.ids)) return null
    const ids = o.ids.filter((x): x is PreflightId => typeof x === 'string' && PREFLIGHT_ORDER.includes(x as PreflightId))
    return { version: o.version, ids }
  } catch {
    return null
  }
}

/** Texto del informe de diagnóstico («Estado de componentes»); el redactor de main lo vuelve a pasar. */
export function reportLines(report: PreflightReport | null): string[] {
  if (!report) return ['  (sin revisión todavía: abre Ajustes › Diagnóstico y pulsa «Revisar de nuevo»)']
  if (report.skipped) return ['  (revisión omitida en este modo)']
  const lines = [`  revisado: ${new Date(report.at).toISOString()}`]
  for (const c of ordered(report)) {
    const status = c.ok ? 'listo' : c.essential ? 'FALTA' : 'pendiente'
    const bits = [c.version ? `versión ${c.version}` : '', c.reason ? `motivo ${c.reason}` : '', c.detail ?? ''].filter(Boolean)
    lines.push(`  ${c.id}: ${status}${c.essential ? ' (esencial)' : ''}${bits.length ? ` — ${bits.join('; ')}` : ''}`)
  }
  if (report.freeBytes !== null) lines.push(`  disco libre: ${Math.round(report.freeBytes / 1e6)} MB`)
  return lines
}
