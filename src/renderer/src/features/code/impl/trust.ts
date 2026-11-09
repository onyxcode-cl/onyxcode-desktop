/**
 * Workspace trust de Code: carpeta pendiente de confirmación + `openProjectTrusted`, la única
 * forma de abrir un proyecto desde una entrada de la UI (`TrustGate` en `ProjectPicker.tsx` pinta el diálogo).
 * La primera vez que se confía en una carpeta se guarda en `trustedFolders` (localStorage).
 *
 * W-A2: antes de decidir, se lee qué trae la carpeta (`project.scan`, solo disco, nunca el motor: el motor arranca los
 * conectores `local` del proyecto apenas la carga, así que esto tiene que pasar ANTES de abrir). El resultado alimenta el
 * diálogo (qué se ve) y las reglas de la sesión (`setFolderMcp`, en `permission-rules.ts`): cada conector de la carpeta
 * pregunta al usarse, salvo que la persona ya lo haya marcado de confianza en Ajustes.
 */
import { useEffect, useState } from 'react'
import type { ProjectScanItem, ProjectScanResult } from '@shared/ipc-code'
import { nativeCode } from './client'
import { setFolderMcp, setVerifying } from './permission-rules'
import { useCode, type TrustedScan } from './store'
import { ensureFolderReadable } from './folder-access'

/** Lo que se le pide pintar al diálogo: la carpeta y, si hay algo que mostrar, el escaneo y qué parte es nueva. */
export interface PendingTrust {
  dir: string
  /** `null`: no se pudo revisar la carpeta (sin API nativa, o la lectura falló o venció el plazo). */
  scan: ProjectScanResult | null
  /** Elementos a listar en el diálogo (todo, o solo lo nuevo si la carpeta ya era de confianza). */
  items: ProjectScanItem[]
  /** La carpeta YA era de confianza y tenemos lo visto antes: esto es una re-pregunta porque trajo algo nuevo. */
  again: boolean
  /** La carpeta ya era de confianza (con o sin huella guardada): cancelar le quita la confianza. */
  wasTrusted: boolean
  /** El escaneo sigue en curso: se muestra «Revisando…» y no se puede confiar todavía. */
  scanning: boolean
  /** Carpeta de confianza que NO se pudo revisar del todo (escaneo fallido, vencido o incompleto con huella distinta): falla cerrado, se pregunta. */
  unreviewed?: boolean
}

/** Un diálogo (el visible o uno en cola) y quienes esperan su respuesta (varias peticiones de la misma carpeta comparten el diálogo). */
interface Entry {
  p: PendingTrust
  resolvers: Array<(trust: boolean) => void>
}
let current: Entry | null = null
const queue: Entry[] = []
const trustListeners = new Set<(p: PendingTrust | null) => void>()
let pendingTrust: PendingTrust | null = null
/** Carpetas de confianza ACEPTADAS en esta ejecución (huella igual, nada nuevo, o la persona confirmó). Distinto de «escaneada». */
const verified = new Set<string>()
const dirId = (d: string): string => d.replace(/[/\\]+$/, '')

/** ¿La carpeta pasó la verificación de confianza en esta ejecución? */
export function isFolderVerified(dir: string): boolean {
  return verified.has(dirId(dir))
}

function setPendingTrust(p: PendingTrust | null): void {
  pendingTrust = p
  for (const l of trustListeners) l(p)
}

const findEntry = (dir: string): Entry | undefined => [current, ...queue].find((e) => e && dirId(e.p.dir) === dirId(dir)) ?? undefined

/** Actualiza el diálogo de `dir` (visible o en cola) cuando llega su escaneo. */
function updateEntry(dir: string, p: PendingTrust): void {
  const e = findEntry(dir)
  if (!e) return
  e.p = p
  if (e === current) setPendingTrust(p)
}

/** Hook: carpeta esperando confirmación de confianza (o `null`). */
export function usePendingTrust(): PendingTrust | null {
  const [p, setP] = useState(pendingTrust)
  useEffect(() => {
    trustListeners.add(setP)
    setP(pendingTrust)
    return () => {
      trustListeners.delete(setP)
    }
  }, [])
  return p
}

/** Tras aparecer cada diálogo, «Confiar» tarda este tiempo en poder pulsarse: un doble clic no puede aceptar también el siguiente de la cola. */
export const CONFIRM_DELAY_MS = 700

/** Plazo del escaneo en el renderer (main corta a los ~2,8 s y devuelve lo reunido como incompleto; esto cubre un main colgado). */
export const SCAN_TIMEOUT_MS = 3500
const inflight = new Map<string, Promise<ProjectScanResult | null>>()

/** ¿Hay con qué revisar carpetas? Sin API nativa (pruebas, superficie sin escáner) no hay nada que fallar: no es un escaneo fallido. */
const canScan = (): boolean => {
  const native = nativeCode()
  return !!native && typeof native.project?.scan === 'function'
}

/** Lee qué trae la carpeta. `null` si no hay API nativa (pruebas, celular sin motor), la lectura falla o vence el plazo: nunca lanza ni cuelga. */
function scanFolder(dir: string): Promise<ProjectScanResult | null> {
  const native = nativeCode()
  if (!native || typeof native.project?.scan !== 'function') return Promise.resolve(null)
  const have = inflight.get(dir)
  if (have) return have
  let timer: ReturnType<typeof setTimeout> | undefined
  const guard = new Promise<null>((res) => {
    timer = setTimeout(() => res(null), SCAN_TIMEOUT_MS)
  })
  const run = native.project.scan(dir).catch(() => null)
  const p = Promise.race([run, guard]).finally(() => {
    clearTimeout(timer)
    inflight.delete(dir)
  })
  inflight.set(dir, p)
  return p
}

const scanToTrustedScan = (scan: ProjectScanResult): TrustedScan => ({ huella: scan.huella, ids: scan.items.map((i) => i.id) })

/**
 * Si la carpeta no es de confianza, pide confirmación (resuelve `true`/`false`). Si ya lo es, puede igual repreguntar si
 * trajo algo nuevo desde la última vez (huella distinta y conectores o complementos que no estaban). Una petición nueva
 * mientras hay otra de carpeta NUEVA pendiente resuelve la anterior con `false` (no queda colgada); las re-preguntas de carpetas de confianza van en cola.
 */
export function ensureTrusted(dir: string): Promise<boolean> {
  if (useCode.getState().isTrusted(dir)) return ensureTrustedAgain(dir)
  // Carpeta nueva: se pregunta de inmediato, SIN esperar el escaneo (hasta ~3 s en una carpeta de red). Mientras tanto «Confiar» no se puede
  // pulsar y las reglas de esta sesión preguntan por CUALQUIER conector (falla cerrado); el escaneo llega después y afina el diálogo y las reglas.
  setFolderMcp(dir, null)
  const promise = showDialog({ dir, scan: null, items: [], again: false, wasTrusted: false, scanning: true })
  void scanFolder(dir).then((scan) => {
    setFolderMcp(dir, scan)
    // Solo si el diálogo de esta MISMA carpeta sigue abierto o en cola (si ya se resolvió, no se toca).
    updateEntry(dir, { dir, scan, items: scan ? scan.items : [], again: false, wasTrusted: false, scanning: false })
  })
  return promise
}

/** Carpeta ya de confianza: se escanea antes de decidir (sin diálogo visible mientras tanto) si hace falta repreguntar. */
async function ensureTrustedAgain(dir: string): Promise<boolean> {
  const dup = findEntry(dir) // ya hay una re-pregunta de esta carpeta (visible o en cola): se comparte, no se duplica
  if (dup) return new Promise<boolean>((res) => dup.resolvers.push(res))
  setVerifying(dir, true)
  const scan = await scanFolder(dir)
  setFolderMcp(dir, scan)
  const prev = useCode.getState().trustedScans[dir]
  // No se pudo revisar (falló o venció el plazo): NO se abre sola. El motor arranca conectores y complementos al cargar la carpeta y no podemos
  // saber si trae algo nuevo, así que se pregunta (falla cerrado). Las reglas quedan en `askAll`.
  if (!scan && !canScan()) return accept(dir) // sin escáner en esta superficie: no hay revisión que hacer (como antes)
  if (!scan) return showDialog({ dir, scan: null, items: [], again: !!prev, wasTrusted: true, scanning: false, unreviewed: true })
  if (prev && prev.huella === scan.huella) return accept(dir)
  // Confianza vieja sin huella (versión anterior) o huella distinta: solo repregunta si hay algo NUEVO que valga la pena ver.
  const seen = new Set(prev?.ids ?? [])
  const risky = scan.items.filter((i) => i.risky)
  const toShow = prev ? risky.filter((i) => !seen.has(i.id)) : risky
  if (!scan.complete && toShow.length === 0) {
    // Revisión incompleta (plazo, tope) y distinta de lo aprobado: lo que faltó por mirar podría ser lo nuevo. No se guarda en silencio.
    return showDialog({ dir, scan, items: [], again: !!prev, wasTrusted: true, scanning: false, unreviewed: true })
  }
  if (toShow.length === 0) {
    // Nada nuevo que importe (o primera huella de una carpeta vieja sin nada riesgoso): se guarda en silencio.
    useCode.getState().trustFolder(dir, scanToTrustedScan(scan))
    return accept(dir)
  }
  return showDialog({ dir, scan, items: toShow, again: !!prev, wasTrusted: true, scanning: false })
}

/**
 * Para las vías que cargan una carpeta de confianza sin pasar por `openProjectTrusted` (restaurar al arrancar, dar el foco desde la barra):
 * escanea y, si trae algo nuevo, repregunta. Si la persona no lo acepta, la carpeta pierde la confianza y NO se carga. `true` = se puede cargar.
 */
export async function verifyTrustedFolder(dir: string): Promise<boolean> {
  if (!useCode.getState().isTrusted(dir)) {
    setVerifying(dir, false)
    return false // sin confianza (p. ej. la rechazó la persona mientras tanto): NO se carga; pide confirmación al entrar
  }
  if (isFolderVerified(dir)) {
    setVerifying(dir, false)
    return true // las aceptadas no se repiten («escaneada» NO basta: puede haber quedado una re-pregunta sin contestar)
  }
  return ensureTrustedAgain(dir)
}

function accept(dir: string): true {
  verified.add(dirId(dir))
  setVerifying(dir, false)
  return true
}

function showDialog(p: PendingTrust): Promise<boolean> {
  const dup = findEntry(p.dir)
  if (dup) return new Promise<boolean>((res) => dup.resolvers.push(res))
  // Un diálogo de carpeta NUEVA (acción de la persona) reemplaza a otro igual (cuenta como «Cancelar», sin efectos). Los de re-pregunta de una
  // carpeta de confianza nunca se reemplazan ni se cancelan solos: esperan su turno en la cola, uno a la vez, para que la persona vea cada uno.
  if (current && !current.p.wasTrusted && !p.wasTrusted) resolveTrust(false)
  return new Promise<boolean>((resolve) => {
    const e: Entry = { p, resolvers: [resolve] }
    if (current) queue.push(e)
    else {
      current = e
      setPendingTrust(p)
    }
  })
}

export function resolveTrust(trust: boolean): void {
  const e = current
  const p = e?.p ?? null
  current = null
  setPendingTrust(null)
  if (trust && p) {
    verified.add(dirId(p.dir))
    setVerifying(p.dir, false)
    if (p.scan) useCode.getState().trustFolder(p.dir, scanToTrustedScan(p.scan))
    else useCode.getState().trustFolder(p.dir)
  } else if (!trust && p) {
    setVerifying(p.dir, false)
    // Cancelar NO suelta las reglas de la carpeta (siguen preguntando los conectores), y si ya era de confianza se la quita: así ninguna vía
    // (restaurar, barra lateral) la vuelve a cargar sin pedir confirmación, y si tenía el foco se cierra.
    if (p.wasTrusted) {
      verified.delete(dirId(p.dir))
      const st = useCode.getState()
      st.untrustFolder(p.dir)
      // Con el foco: se cierra y el foco no pasa a otra sin confianza. Sin el foco: también se cierra, para que nada la vuelva a cargar sin preguntar.
      if (st.directory && dirId(st.directory) === dirId(p.dir)) st.declineFocusedProject(p.dir)
      else st.closeOneProject(p.dir)
    }
  }
  for (const r of e?.resolvers ?? []) r(trust)
  // Siguiente diálogo en cola.
  const next = queue.shift()
  if (next) {
    current = next
    setPendingTrust(next.p)
  }
}

/**
 * Confirma la confianza (si hace falta), comprueba que macOS deja leer la carpeta (F8-B210) y abre el proyecto. Devuelve `false`
 * si el usuario no confió o si la carpeta no se puede leer (en ese caso queda la tarjeta de permisos y no se arranca el motor).
 */
export async function openProjectTrusted(dir: string, opts: { passive?: boolean; fresh?: boolean } = {}): Promise<boolean> {
  if (!(await ensureTrusted(dir))) return false
  // Acción de la persona: si macOS guardó un «No permitir», se vuelve a preguntar (ver `ensureFolderReadable`). `passive` (restaurar al
  // arrancar) nunca insiste.
  if (!(await ensureFolderReadable(dir, { reask: !opts.passive }))) return false
  if (opts.fresh) await useCode.getState().openProject(dir, { fresh: true })
  else await useCode.getState().openProject(dir)
  return true
}

let restoring: Promise<void> | null = null

/**
 * Arranque: la carpeta que tenía el foco al cerrar la app (`restoredFocus`) pasa por el MISMO escaneo y la MISMA decisión de confianza que
 * cualquier otra ANTES de ser el foco. Mientras tanto `directory` es `null` y `restoredFocus` sigue puesto: Code muestra «revisando» (sin
 * selector de recientes) y los componentes que piden al motor con `directory` (compositor, paneles) no se activan.
 * El motor carga la carpeta (complementos con cualquier petición, conectores con `command.list`/`GET /mcp`) en cuanto algo le pide con ella.
 * Si la persona no la acepta, o la carpeta no era de confianza, se cierra. Se puede llamar varias veces (reconexión): comparte la misma espera.
 */
export function restoreFocusedProject(): Promise<void> {
  if (restoring) return restoring
  const dir = useCode.getState().restoredFocus
  if (!dir) return Promise.resolve()
  restoring = (async () => {
    try {
      const ok = await openProjectTrusted(dir, { passive: true })
      if (!ok) useCode.getState().closeOneProject(dir)
    } finally {
      restoring = null
      const st = useCode.getState()
      if (st.restoredFocus && dirId(st.restoredFocus) === dirId(dir)) useCode.setState({ restoredFocus: null })
    }
  })()
  return restoring
}
