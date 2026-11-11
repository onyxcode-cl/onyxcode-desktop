/**
 * Descargas del navegador integrado (Lote D, B.9 y D1 paso 7).
 *
 * - Del agente: se pausan, se pide aprobación (tarjeta `kind:'download'`, B.8) con nombre y
 *   destino; si se aprueba, se guardan y se marca con `com.apple.quarantine` (D0 corrección 4:
 *   Electron NO pone esa marca sola en macOS, así que si queremos que Gatekeeper avise antes de
 *   abrir un archivo que trajo el agente, hay que añadirla a mano con `xattr`).
 * - Del usuario: diálogo de guardado nativo (`dialog.showSaveDialog`), como el resto de la app.
 * - Nunca se abren solas (ni `shell.openPath` ni nada parecido aquí).
 * - Destinos: Tareas → `<carpeta>/.lazunox/trabajo/descargas/`; Code → `~/Downloads/<INTERNAL_NAME>/`.
 */
import { execFile } from 'node:child_process'
import { linkSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, unlinkSync } from 'node:fs'
import { rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, extname, isAbsolute, join, relative, sep } from 'node:path'
import { app, dialog, Notification, type DownloadItem, type WebContents } from 'electron'
import { INTERNAL_NAME } from '@shared/brand'
import { t } from '@shared/i18n'
import type { BrowserOwner } from '@shared/ipc-browser'
import { migrateFolderScratch } from '../migrations/migrate-folder-scratch'
import { ensureRealDir, isWriteDenied } from '../tasks/no-follow'
import { candidateNames, SafeTempFile, safeCopyIntoDir } from '../tasks/safe-write'
import { hostOf, siteOf } from './sites'
import { requestApproval } from './approvals'
import { tabByWebContents } from './surface'

export interface DownloadAttribution {
  /** `true` = atribuida al agente (pide aprobación); `false` = del usuario (diálogo nativo). */
  agent: boolean
  sessionId: string | null
}

export interface DownloadsDeps {
  attributionFor(owner: BrowserOwner): DownloadAttribution
}

let deps: DownloadsDeps | null = null

export function initDownloads(d: DownloadsDeps): void {
  deps = d
  cleanStagingLeftovers() // una sola vez por proceso
}

/** Una vez por arranque: borra las carpetas de paso (`d-*`) que dejó una sesión anterior (cierre brusco). Sin seguir enlaces; no falla. */
let leftoversCleaned = false
export function cleanStagingLeftovers(force = false): void {
  if (leftoversCleaned && !force) return
  leftoversCleaned = true
  try {
    const base = join(app.getPath('userData'), 'descargas-pendientes')
    for (const entry of readdirSync(base)) {
      if (!entry.startsWith('d-')) continue
      try {
        rmSync(join(base, entry), { recursive: true, force: true })
      } catch (err) {
        console.warn('[embedded-browser] no se pudo borrar un resto de descarga anterior:', entry, err)
      }
    }
  } catch {
    /* la carpeta no existe (o no se puede leer): nada que limpiar */
  }
}

function destinationDir(owner: BrowserOwner): string {
  if (owner.kind === 'tasks') return join(owner.folder, '.lazunox', 'trabajo', 'descargas')
  return join(homedir(), 'Downloads', INTERNAL_NAME)
}

const WIN_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i
const MAX_NAME_BYTES = 200

/** Recorta `text` a `max` bytes UTF-8 sin partir un carácter. */
function clipBytes(text: string, max: number): string {
  let out = ''
  let used = 0
  for (const ch of text) {
    const n = Buffer.byteLength(ch)
    if (used + n > max) break
    out += ch
    used += n
  }
  return out
}

/**
 * Nombre de archivo simple (defensa adicional a Electron): sin separadores, bytes nulos ni caracteres de control, sin los caracteres que
 * Windows no admite (`<>:"|?*`), sin puntos ni espacios al final, `.`/`..` → `descarga`, sin nombres reservados de Windows (CON, NUL,
 * COM1…) y de ~200 bytes como máximo conservando la extensión.
 */
export function sanitizeFileName(name: string): string {
  let base = name.replace(/[/\\\0<>:"|?*\u0001-\u001f\u007f]/g, '_').trim()
  base = base.replace(/[. ]+$/, '')
  if (!base) return 'descarga'
  if (WIN_RESERVED.test(base.split('.')[0].trim())) base = `_${base}`
  if (Buffer.byteLength(base) > MAX_NAME_BYTES) {
    const ext = clipBytes(extname(base), 40)
    base = clipBytes(base.slice(0, base.length - extname(base).length), MAX_NAME_BYTES - Buffer.byteLength(ext)) + ext
    base = base.replace(/[. ]+$/, '') || 'descarga'
  }
  return base
}

/** ¿Hay algo con ese nombre? Con `lstat`: un enlace roto también cuenta (con `existsSync` se escribía a través de él). */
function taken(p: string): boolean {
  try {
    lstatSync(p)
    return true
  } catch {
    return false
  }
}

function uniquePath(dir: string, name: string): string {
  let candidate = join(dir, name)
  if (!taken(candidate)) return candidate
  const dot = name.lastIndexOf('.')
  const stem = dot > 0 ? name.slice(0, dot) : name
  const ext = dot > 0 ? name.slice(dot) : ''
  for (let i = 2; i < 1000; i++) {
    candidate = join(dir, `${stem} (${i})${ext}`)
    if (!taken(candidate)) return candidate
  }
  return join(dir, `${stem}-${Date.now()}${ext}`)
}

/**
 * D0 corrección 4: Electron no marca `com.apple.quarantine` sola. Solo macOS; en cualquier otro
 * caso (o si `xattr` falla) no rompe la descarga, solo se queda sin el aviso de Gatekeeper.
 */
function applyQuarantine(filePath: string): void {
  if (process.platform !== 'darwin') return
  const stamp = Math.floor(Date.now() / 1000)
    .toString(16)
    .padStart(8, '0')
  const value = `0083;${stamp};${INTERNAL_NAME};`
  execFile('/usr/bin/xattr', ['-w', 'com.apple.quarantine', value, filePath], (err) => {
    if (err) console.warn('[embedded-browser] no se pudo poner com.apple.quarantine:', err)
  })
}

/**
 * Contenido del flujo `Zone.Identifier` (marca «descargado de Internet», ZoneId=3) que usa
 * SmartScreen. `HostUrl` lleva la URL SIN usuario ni contraseña; no se escribe `ReferrerUrl`
 * porque puede arrastrar datos privados. Si la URL no se puede interpretar, se omite `HostUrl`.
 */
export function zoneIdentifierContent(url: string): string {
  let host = ''
  try {
    const u = new URL(url)
    u.username = ''
    u.password = ''
    u.hash = ''
    host = u.href
  } catch {
    host = ''
  }
  const hostLine = host ? `HostUrl=${host.replace(/[\r\n]/g, '')}\r\n` : ''
  return `[ZoneTransfer]\r\nZoneId=3\r\n${hostLine}`
}

/** Solo Windows. Si falla (p. ej. FAT32, sin flujos NTFS) deja un aviso y no rompe la descarga. */
async function applyZoneIdentifier(filePath: string, url: string): Promise<void> {
  if (process.platform !== 'win32') return
  try {
    await writeFile(`${filePath}:Zone.Identifier`, zoneIdentifierContent(url))
  } catch (err) {
    console.warn('[embedded-browser] no se pudo escribir Zone.Identifier:', err)
  }
}

function ownerOf(wc: WebContents): BrowserOwner | null {
  return tabByWebContents(wc)?.owner ?? null
}

/**
 * Carpeta de paso de TODA descarga (1.8.19: antes solo Tareas). Electron solo respeta `setSavePath` si se llama de forma SÍNCRONA dentro de
 * `will-download`; si no, abre su propio diálogo «Guardar como». Por eso toda descarga se fija aquí al empezar, se pausa mientras se decide
 * el destino y al terminar se mueve a él.
 * Para Tareas, además (1.8.18): la tarea controla `<carpeta>/.lazunox/trabajo/descargas` desde dentro del encierro y podía dejar ahí
 * enlaces (la carpeta, el nombre del archivo o el temporal `.crdownload`) hacia, por ejemplo, `~/Library/LaunchAgents`. Chromium descarga
 * en una carpeta de `userData` (ilegible e inescribible desde dentro) y al terminar el archivo se mueve a la carpeta de la tarea con la
 * ruta comprobada tramo a tramo (sin enlaces) y con un nombre libre.
 */
export function stagingDirForDownload(userData: string): string {
  const base = join(userData, 'descargas-pendientes')
  mkdirSync(base, { recursive: true, mode: 0o700 })
  return mkdtempSync(join(base, 'd-'))
}

/**
 * Deja la descarga terminada en la carpeta de descargas de la tarea sin seguir enlaces. Devuelve la ruta final, o null si no se pudo.
 * Corrección tras la revisión 1: antes era `rename(staged, final)` por ruta después de comprobar las carpetas, y un proceso de la tarea
 * que cambiara `descargas` por un enlace justo entre medias dejaba el archivo (nombre y contenido del atacante) en el destino del enlace,
 * por ejemplo `~/Library/LaunchAgents`. Ahora: escritura segura (`safe-write.ts`: temporal de nombre al azar verificado después de abrir,
 * copia POR DESCRIPTOR sin bloquear el proceso principal, `link` con el primer nombre libre) y, además, `descargas` y sus madres no se
 * pueden renombrar desde dentro del encierro (perfil Seatbelt). La copia en `staged` la borra quien llama.
 */
export async function moveDownloadIntoTaskFolder(staged: string, folder: string, dir: string, name: string): Promise<string | null> {
  try {
    return await safeCopyIntoDir(folder, dir, staged, candidateNames(name))
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code ?? 'sin código'
    console.warn(
      `[embedded-browser] no se pudo dejar la descarga en la carpeta de la tarea (error ${code}; puede ser un enlace en el camino, un archivo de paso que ya no existe u otro fallo de disco):`,
      err
    )
    return null
  }
}

/** ¿El disco donde está `p` no distingue mayúsculas? Se comprueba de verdad (la misma carpeta con las letras cambiadas), sin depender del sistema. */
function isCaseInsensitive(p: string): boolean {
  try {
    const swapped = p.replace(/[a-zA-Z]/g, (c) => (c === c.toLowerCase() ? c.toUpperCase() : c.toLowerCase()))
    if (swapped === p) return false
    const a = lstatSync(p)
    const b = lstatSync(swapped)
    return a.ino === b.ino && a.dev === b.dev
  } catch {
    return false
  }
}

/** Carpeta real de `dir`, o la de su madre existente más cercana más el tramo que falta. null si no se puede resolver. */
function resolveDirLoose(dir: string): string | null {
  const missing: string[] = []
  let cur = dir
  for (let i = 0; i < 64; i++) {
    try {
      return join(realpathSync(cur), ...missing.reverse())
    } catch {
      const up = dirname(cur)
      if (up === cur) return null
      missing.push(basename(cur))
      cur = up
    }
  }
  return null
}

/**
 * ¿`dest` cae dentro de la carpeta de la tarea? Compara formas reales (`/var` y `/private/var`, barra final, mayúsculas en macOS y
 * Windows). Devuelve la carpeta real de la tarea y la real del destino, o null si cae fuera. Si no se puede resolver algo, se trata como
 * DENTRO (camino seguro): devuelve `unresolved`.
 */
export function locateInTaskFolder(folder: string, destDir: string): { base: string; dir: string } | 'unresolved' | null {
  let base: string
  try {
    base = realpathSync(folder)
  } catch {
    return 'unresolved'
  }
  const dir = resolveDirLoose(destDir)
  if (!dir) return 'unresolved'
  const ci = isCaseInsensitive(base)
  const rel = relative(ci ? base.toLowerCase() : base, ci ? dir.toLowerCase() : dir)
  if (rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel)) return null
  // Con la misma forma de mayúsculas que la carpeta de la tarea, para que la escritura segura compare igual.
  return { base, dir: rel === '' ? base : join(base, dir.slice(base.length + 1)) }
}

/**
 * Destino DENTRO de la carpeta de la tarea elegido por la persona: escritura segura (sin seguir enlaces) y reemplaza ese nombre exacto
 * (la persona ya confirmó el reemplazo en el diálogo). Un enlace con ese nombre no se sigue ni se reemplaza: se cancela con registro.
 */
async function moveIntoTaskFolderReplacing(staged: string, base: string, dir: string, name: string): Promise<string | null> {
  const tmp = SafeTempFile.create(base, dir, { create: true })
  try {
    await tmp.copyFrom(staged)
    return tmp.commit(name, { replace: true, refuseLinkTarget: true })
  } finally {
    tmp.discard()
  }
}

/**
 * Mueve el archivo de la carpeta de paso a su destino FUERA de una tarea (Code o ruta elegida por la persona).
 * Agente (`avoidOverwrite`): nunca pisa nada: `link` + `unlink` del origen (EEXIST → siguiente nombre libre). Persona: `rename` (la persona
 * ya confirmó el reemplazo). Si es otro disco (EXDEV) o no hay enlaces duros: se copia a un temporal de nombre al azar junto al destino
 * (`O_EXCL|O_NOFOLLOW`, `SafeTempFile`) y se termina con `link` (agente) o `rename` (persona); el temporal se borra si algo falla.
 */
export async function moveDownloadToPath(staged: string, dest: string, avoidOverwrite: boolean): Promise<string> {
  const destDir = realpathSync(dirname(dest))
  const name = basename(dest)
  const viaTemp = async (): Promise<string> => {
    const tmp = SafeTempFile.create(destDir, destDir, { create: false })
    try {
      await tmp.copyFrom(staged)
      if (!avoidOverwrite) {
        const out = tmp.commit(name, { replace: true })
        if (out) return out
      } else {
        for (const n of candidateNames(name)) {
          const out = tmp.commit(n)
          if (out) return out
        }
      }
      throw Object.assign(new Error('sin nombre libre'), { code: 'EEXIST' })
    } finally {
      tmp.discard()
    }
  }
  if (!avoidOverwrite) {
    try {
      await rename(staged, join(destDir, name))
      return join(destDir, name)
    } catch (err) {
      if ((err as NodeJS.ErrnoException)?.code !== 'EXDEV') throw err
      return viaTemp()
    }
  }
  for (const n of candidateNames(name)) {
    const target = join(destDir, n)
    try {
      moveOps.link(staged, target)
    } catch (err) {
      const code = (err as NodeJS.ErrnoException)?.code
      if (code === 'EEXIST') continue
      if (code === 'EXDEV' || code === 'EPERM' || code === 'ENOTSUP' || code === 'EOPNOTSUPP' || code === 'ENOSYS') return viaTemp()
      throw err
    }
    try {
      moveOps.unlink(staged)
    } catch {
      /* queda el de paso: se borra con su carpeta */
    }
    return target
  }
  throw Object.assign(new Error('sin nombre libre'), { code: 'EEXIST' })
}

/** Solo pruebas: las llamadas que se simulan (carrera entre medias, otro disco). */
export const moveOps = {
  link: linkSync as (a: string, b: string) => void,
  unlink: unlinkSync as (p: string) => void
}

/** Deja el archivo de paso en su destino final según el caso. Devuelve la ruta final o null. */
async function placeDownload(owner: BrowserOwner, dir: string, staged: string, savePath: string, agent: boolean): Promise<string | null> {
  if (owner.kind === 'tasks') {
    const where = locateInTaskFolder(owner.folder, dirname(savePath))
    if (where) {
      // Dentro de la carpeta de la tarea (o no se pudo resolver): siempre por la ruta segura, sin seguir enlaces.
      if (agent && dirname(savePath) === dir) return moveDownloadIntoTaskFolder(staged, owner.folder, dir, basename(savePath))
      if (where === 'unresolved') {
        console.warn('[embedded-browser] no se pudo comprobar el destino de la descarga dentro de la tarea: cancelada')
        return null
      }
      try {
        return agent
          ? await safeCopyIntoDir(where.base, where.dir, staged, candidateNames(basename(savePath)))
          : await moveIntoTaskFolderReplacing(staged, where.base, where.dir, basename(savePath))
      } catch (err) {
        const code = (err as NodeJS.ErrnoException)?.code ?? 'sin código'
        console.warn(`[embedded-browser] no se pudo dejar la descarga en la carpeta de la tarea (error ${code}):`, err)
        return null
      }
    }
  }
  return moveDownloadToPath(staged, savePath, agent)
}

export function handleWillDownload(event: Electron.Event, item: DownloadItem, wc: WebContents): void {
  const owner = ownerOf(wc)
  if (!owner || !deps) {
    console.warn('[embedded-browser] descarga sin owner reconocido: cancelada')
    event.preventDefault()
    return
  }
  const dir = destinationDir(owner)
  // Migra la carpeta de trabajo heredada a `.lazunox/trabajo/` antes de escribir.
  if (owner.kind === 'tasks') migrateFolderScratch(owner.folder, (m, e) => console.warn('[embedded-browser]', m, e ?? ''))
  try {
    if (owner.kind === 'tasks') ensureRealDir(owner.folder, dir, { create: true })
    else mkdirSync(dir, { recursive: true })
  } catch (err) {
    if (owner.kind === 'tasks' && isWriteDenied(err)) {
      // Carpeta de la tarea sin permiso de escritura (la tarea arranca igual): no se descarga ahí; mensaje claro a la persona.
      const msg = t('merr.task.folderReadOnly', { path: join('.lazunox', 'trabajo', 'descargas') })
      console.warn('[embedded-browser] descarga cancelada:', msg, err)
      try {
        if (Notification.isSupported()) new Notification({ title: app.getName(), body: msg }).show()
      } catch {
        /* sin notificaciones: queda en el registro */
      }
      event.preventDefault()
      return
    }
    if (owner.kind === 'tasks') {
      // Un enlace (u otra cosa) en `.lazunox/trabajo/descargas`: no se descarga ahí ni a través de él.
      console.warn('[embedded-browser] la carpeta de descargas de la tarea no es una carpeta normal: descarga cancelada', err)
      event.preventDefault()
      return
    }
    console.error('[embedded-browser] no se pudo crear la carpeta de descargas:', err)
  }
  const fileName = sanitizeFileName(item.getFilename())
  const attribution = deps.attributionFor(owner)

  // SÍNCRONO y antes de cualquier espera: Electron solo respeta `setSavePath` dentro de `will-download`.
  let staging: string
  try {
    staging = stagingDirForDownload(app.getPath('userData'))
    item.setSavePath(join(staging, fileName))
  } catch (err) {
    console.error('[embedded-browser] no se pudo preparar la carpeta de paso de la descarga: cancelada', err)
    event.preventDefault()
    return
  }
  item.pause()

  const cleanStaging = (): void => {
    try {
      rmSync(staging, { recursive: true, force: true })
    } catch (err) {
      console.warn('[embedded-browser] no se pudo borrar la carpeta de paso:', err)
    }
  }
  let ended = false // `done` ya ocurrió
  let decide: (savePath: string | null) => void = () => {}
  const decision = new Promise<string | null>((resolve) => {
    decide = resolve
  })

  // `done` se registra ya, para no perder uno temprano (p. ej. la página cancela la descarga, o termina, mientras se espera la decisión).
  item.once('done', (_e, state) => {
    void (async () => {
      ended = true
      if (state !== 'completed') {
        decide(null)
        cleanStaging()
        return
      }
      const savePath = await decision // terminada antes de decidir: se espera la decisión
      if (!savePath) {
        cleanStaging()
        return
      }
      const staged = join(staging, fileName)
      let finalPath: string | null = null
      try {
        finalPath = await placeDownload(owner, dir, staged, savePath, attribution.agent)
      } catch (err) {
        const code = (err as NodeJS.ErrnoException)?.code ?? 'sin código'
        console.warn(`[embedded-browser] no se pudo mover la descarga a su destino (error ${code}):`, err)
      } finally {
        cleanStaging()
      }
      if (!finalPath) return
      if (attribution.agent) applyQuarantine(finalPath)
      void applyZoneIdentifier(finalPath, item.getURL())
    })().catch((err) => console.warn('[embedded-browser] al terminar la descarga:', err))
  })

  const finish = (savePath: string | null): void => {
    decide(savePath)
    if (!savePath) {
      // La carpeta de paso la borra `done` (en Windows el archivo puede seguir tomado justo tras cancelar).
      if (!ended) item.cancel()
      return
    }
    if (!ended) item.resume()
  }

  if (attribution.agent) {
    const url = item.getURL()
    const host = hostOf(url) ?? ''
    void requestApproval({
      owner,
      sessionId: attribution.sessionId ?? '',
      kind: 'download',
      url,
      host,
      site: host ? siteOf(host) : '',
      fileName,
      savePath: uniquePath(dir, fileName)
    })
      .then((d) => finish(d === 'allow' ? uniquePath(dir, fileName) : null))
      .catch((err) => {
        console.error('[embedded-browser] aprobación de descarga:', err)
        finish(null)
      })
  } else {
    void dialog
      .showSaveDialog({ defaultPath: uniquePath(dir, fileName) })
      .then((res) => finish(res.canceled || !res.filePath ? null : res.filePath))
      .catch((err) => {
        console.error('[embedded-browser] diálogo de descarga:', err)
        finish(null)
      })
  }
}
