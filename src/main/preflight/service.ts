/**
 * Servicio de la revisión de arranque: AGREGA las comprobaciones que ya existen (motor, ArtCraft, permisos y ubicación de la app,
 * ayudante, entorno aislado, disco) en un `PreflightReport`, sin duplicarlas. Todo lo que toca el sistema entra por `PreflightDeps`
 * (se prueba sin Electron). Solo mira el disco y procesos locales: nada de red, y cada comprobación tiene su plazo para que el total
 * quede muy por debajo de 2 s. Nunca lanza: una comprobación que se rompe NO bloquea la app (se anota y se da por buena).
 */
import type { PreflightComponent, PreflightReport } from '@shared/preflight'
import { SANDBOX_APPROX_BYTES, DISK_FACTOR } from '@shared/preflight'
import { permsStage } from '@shared/mac-permissions'
import type { CraftPart } from '../office/craft/craft-install'

export const CHECK_TIMEOUT_MS = 1500

export type AppPlacement = 'translocated' | 'volume' | 'elsewhere' | null

export interface CraftCheck {
  state: 'unsupported' | 'installed' | 'missing'
  /** Versión del pin actual. */
  version?: string
  /** Bytes que faltan por descargar (solo `missing`). */
  sizeBytes?: number
  parts: CraftPart[]
}

/** Node.js y uv de la app (conectores locales). Solo disco. */
export interface RuntimesCheck {
  /** Esta plataforma ofrece conectores locales (si no, no se pinta ni se descarga nada). */
  offered: boolean
  ready: boolean
  /** Hay algo instalado pero dañado o de otra versión. */
  broken: boolean
  /** Bytes que faltan por descargar. */
  sizeBytes: number
  version?: string
}

export interface PreflightDeps {
  platform: string
  appVersion: string
  now: () => number
  /** Motor de agentes: ¿está y ejecuta (`--version`)? */
  engine: () => Promise<{ found: boolean; version: string | null }>
  craft: () => CraftCheck
  /** Node.js y uv de la app; ausente = no aplica. */
  runtimes?: () => RuntimesCheck
  /** Entorno aislado de Tareas (solo Windows con WSL); `null` = no aplica. */
  sandbox?: () => Promise<{ state: string; detail?: string } | null>
  /** Ayudante de control (`cu-helper`): solo si esta plataforma ofrece Control del PC. */
  helperPresent?: () => boolean
  /** Solo macOS: permisos, y dónde corre la app. */
  mac?: {
    status: () => Promise<{ accessibility: boolean; screenRecording: boolean } | null>
    placement: () => AppPlacement
  }
  /** Solo macOS: ¿tiene la app «Acceso total al disco»? (solo lectura, sin pedir nada). Opcional y silencioso. */
  fullDisk?: () => Promise<'granted' | 'denied' | 'unknown'>
  freeBytes: () => number | null
  userDataWritable: () => boolean
  /** Un fallo inesperado de una comprobación (se anota en el registro de problemas). */
  onCheckError?: (id: string, err: unknown) => void
  timeoutMs?: number
}

/** Plazo de la consulta al entorno aislado de Windows (`wsl.exe` puede tardar más que el resto de comprobaciones). */
export const SANDBOX_TIMEOUT_MS = 4000

/** El botón instala el entorno si falta (`needsSetup`) o si su imagen está rota (`broken/payload`); lo demás pide cambios del sistema o de la organización. */
const sandboxInstallable = (s: { state: string; detail?: string }): boolean =>
  s.state === 'needsSetup' || (s.state === 'broken' && s.detail === 'payload')
const SANDBOX_IGNORED = new Set(['unsupported', 'policyDisabled'])

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | typeof TIMED_OUT> {
  let timer: ReturnType<typeof setTimeout>
  const t = new Promise<typeof TIMED_OUT>((r) => {
    timer = setTimeout(() => r(TIMED_OUT), ms)
    timer.unref?.()
  })
  return Promise.race([p, t]).finally(() => clearTimeout(timer))
}
const TIMED_OUT = Symbol('timeout')

/** Piezas dañadas en una línea (`wordcraft:truncated, web-gridcraft:no-mark`) para el informe. */
export function craftPartsDetail(parts: CraftPart[]): string {
  const bad = parts.filter((p) => p.problem !== null).map((p) => `${p.name}:${p.problem}`)
  return bad.length ? `piezas: ${bad.join(', ')}` : ''
}

function craftComponent(c: CraftCheck): PreflightComponent | null {
  if (c.state === 'unsupported') return null
  if (c.state === 'installed') return { id: 'craft', essential: false, ok: true, installable: true, version: c.version }
  const total = c.parts.length
  const bad = c.parts.filter((p) => p.problem !== null)
  return {
    id: 'craft',
    // Opcional: sin ArtCraft se puede chatear y programar; se instala cuando la persona quiere documentos con diseño (aquí o en Ajustes).
    essential: false,
    ok: false,
    installable: true,
    // `missing` = no hay nada (primer uso); `incomplete` = hay piezas pero faltan o están dañadas.
    reason: total > 0 && bad.length < total ? 'incomplete' : 'missing',
    sizeBytes: c.sizeBytes,
    version: c.version,
    detail: craftPartsDetail(c.parts)
  }
}

function runtimesComponent(r: RuntimesCheck): PreflightComponent | null {
  if (!r.offered) return null
  // Opcional: sin Node.js y uv todo funciona salvo los conectores locales de correo, calendario y archivos; se reintenta cuando se quiera.
  if (r.ready) return { id: 'runtimes', essential: false, ok: true, installable: true, ...(r.version ? { version: r.version } : {}) }
  return {
    id: 'runtimes',
    essential: false,
    ok: false,
    installable: true,
    reason: r.broken ? 'broken' : 'missing',
    sizeBytes: r.sizeBytes,
    ...(r.version ? { version: r.version } : {})
  }
}

export async function runPreflightChecks(d: PreflightDeps): Promise<PreflightReport> {
  const ms = d.timeoutMs ?? CHECK_TIMEOUT_MS
  const out: PreflightComponent[] = []
  const guard = async <T>(id: string, fn: () => T | Promise<T>, limit = ms): Promise<T | null> => {
    try {
      const r = await withTimeout(Promise.resolve().then(fn), limit)
      if (r === TIMED_OUT) {
        d.onCheckError?.(id, new Error(`la comprobación tardó más de ${limit} ms`))
        return null
      }
      return r
    } catch (err) {
      d.onCheckError?.(id, err)
      return null
    }
  }

  const [engine, craft, runtimes, sandbox, mac, free, writable] = await Promise.all([
    guard('engine', d.engine),
    guard('craft', d.craft),
    d.runtimes ? guard('runtimes', d.runtimes) : Promise.resolve(null),
    d.sandbox ? guard('sandbox', d.sandbox, Math.max(ms, SANDBOX_TIMEOUT_MS)) : Promise.resolve(null),
    d.mac ? guard('perms', d.mac.status) : Promise.resolve(null),
    guard('disk', d.freeBytes),
    guard('storage', d.userDataWritable)
  ])
  const fullDisk = d.fullDisk ? await guard('files', d.fullDisk, Math.max(ms, 3000)) : null
  const helper = d.helperPresent ? await guard('helper', d.helperPresent) : null

  // Carpeta de datos: si no se puede escribir, nada se instala ni se guarda.
  out.push({
    id: 'storage',
    essential: true,
    ok: writable !== false,
    ...(writable === false ? { reason: 'not-writable', installable: false } : { installable: false })
  })

  // Motor: presente Y respondiendo (`--version`). Una comprobación rota se da por buena para no bloquear sin motivo.
  if (engine) {
    const ok = engine.found && engine.version !== null
    out.push({
      id: 'engine',
      essential: true,
      ok,
      installable: false,
      ...(engine.version ? { version: engine.version } : {}),
      ...(ok ? {} : { reason: engine.found ? 'not-responding' : 'not-found' })
    })
  } else out.push({ id: 'engine', essential: true, ok: true, installable: false, detail: 'comprobación no disponible' })

  const cc = craft ? craftComponent(craft) : null
  if (cc) out.push(cc)

  const rc = runtimes ? runtimesComponent(runtimes) : null
  if (rc) out.push(rc)

  if (sandbox && !SANDBOX_IGNORED.has(sandbox.state)) {
    const ok = sandbox.state === 'ready'
    const installable = sandboxInstallable(sandbox)
    out.push({
      id: 'sandbox',
      // Opcional: solo lo necesita el modo Tareas; se prepara aquí o cuando la persona lo abra.
      essential: false,
      ok,
      installable,
      ...(ok ? {} : { reason: sandbox.state, sizeBytes: installable ? SANDBOX_APPROX_BYTES : undefined }),
      ...(sandbox.detail ? { detail: sandbox.detail } : {})
    })
  }

  // Disco: avisa si no alcanza para lo que falte instalar (ArtCraft ×4, Node.js y uv ×6, entorno aislado ×1); no bloquea la app, solo la instalación.
  const need = out.reduce((n, c) => (!c.ok && c.installable ? n + (c.sizeBytes ?? 0) * (DISK_FACTOR[c.id] ?? 1) : n), 0)
  const freeBytes = typeof free === 'number' ? free : null
  const diskOk = need === 0 || freeBytes === null || freeBytes >= need
  out.push({
    id: 'disk',
    essential: false,
    ok: diskOk,
    installable: false,
    ...(diskOk
      ? {}
      : { reason: 'low-space', detail: `libres ${Math.round((freeBytes ?? 0) / 1e6)} MB, hacen falta ${Math.ceil(need / 1e6)} MB` })
  })

  if (d.helperPresent && helper !== null)
    out.push({ id: 'helper', essential: false, ok: helper, installable: false, ...(helper ? {} : { reason: 'not-found' }) })

  if (d.mac) {
    if (mac) {
      const stage = permsStage(mac)
      const reason = stage === 'ready' ? undefined : stage === 'restart' ? 'restart' : mac.screenRecording ? 'accessibility' : 'both'
      out.push({ id: 'perms', essential: false, ok: stage === 'ready', installable: false, ...(reason ? { reason } : {}) })
    } else out.push({ id: 'perms', essential: false, ok: false, installable: false, reason: 'unknown' })
    const place = d.mac.placement()
    out.push({ id: 'location', essential: false, ok: place === null, installable: false, ...(place ? { reason: place } : {}) })
  }

  // Opcional y silencioso: `ok` solo si está concedido; si no se pudo saber, queda pendiente con `unknown`.
  if (d.fullDisk) {
    out.push({
      id: 'files',
      essential: false,
      ok: fullDisk === 'granted',
      installable: false,
      ...(fullDisk === 'granted' ? {} : { reason: fullDisk === 'denied' ? 'denied' : 'unknown' })
    })
  }

  return { at: d.now(), platform: d.platform, appVersion: d.appVersion, components: out, freeBytes }
}

/** Informe de «no hace falta revisar» (pruebas automáticas): la pantalla no se muestra. */
export function skippedReport(d: Pick<PreflightDeps, 'platform' | 'appVersion' | 'now'>): PreflightReport {
  return { at: d.now(), platform: d.platform, appVersion: d.appVersion, components: [], freeBytes: null, skipped: true }
}

/** Dónde corre la app en macOS: translocada, desde un volumen, fuera de Aplicaciones o normal. */
export function placementOf(o: {
  execPath: string
  home: string
  packaged: boolean
  platform: string
  classify: (p: string, plat: string) => 'translocated' | 'volume' | null
}): AppPlacement {
  if (o.platform !== 'darwin') return null
  const c = o.classify(o.execPath, o.platform)
  if (c) return c
  if (!o.packaged) return null
  return o.execPath.startsWith('/Applications/') || o.execPath.startsWith(`${o.home}/Applications/`) ? null : 'elsewhere'
}

/** Detalle de un fallo de instalación para «Copiar detalle» (la redacción la hace quien lo sirve). */
export function failureDetail(o: {
  id: string
  code?: string
  message?: string
  platform: string
  arch: string
  appVersion: string
  componentDetail?: string
}): string {
  return [
    `Componente: ${o.id}`,
    `Motivo: ${o.code ?? 'desconocido'}`,
    o.message ? `Mensaje: ${o.message}` : '',
    o.componentDetail ? `Detalle: ${o.componentDetail}` : '',
    `App: ${o.appVersion}`,
    `Sistema: ${o.platform} ${o.arch}`
  ]
    .filter(Boolean)
    .join('\n')
}
