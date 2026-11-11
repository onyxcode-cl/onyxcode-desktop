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
import { lstatSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { copyFile, rename, unlink, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { app, dialog, Notification, type DownloadItem, type WebContents } from 'electron'
import { INTERNAL_NAME } from '@shared/brand'
import { t } from '@shared/i18n'
import type { BrowserOwner } from '@shared/ipc-browser'
import { migrateFolderScratch } from '../migrations/migrate-folder-scratch'
import { ensureRealDir, isWriteDenied } from '../tasks/no-follow'
import { candidateNames, safeCopyIntoDir } from '../tasks/safe-write'
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
  cleanStagingLeftovers()
}

/** Una vez por arranque: borra las carpetas de paso (`d-*`) que dejó una sesión anterior (cierre brusco). Sin seguir enlaces; no falla. */
export function cleanStagingLeftovers(): void {
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

/** Nombre de archivo simple, sin separadores de ruta ni bytes nulos (defensa adicional a Electron). */
function sanitizeFileName(name: string): string {
  const base = name.replace(/[/\\\0]/g, '_').trim()
  return base || 'descarga'
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

/**
 * Mueve el archivo de la carpeta de paso a su destino (Code o ruta elegida por la persona): `rename`; si es otro disco (`EXDEV`), copia y
 * borra. Persona: lo elegido en el diálogo se reemplaza (el sistema ya pidió confirmación). Agente: no pisa nada; si apareció algo con ese
 * nombre mientras tanto, se calcula un nombre libre. Devuelve la ruta final.
 */
export async function moveDownloadToPath(staged: string, dest: string, avoidOverwrite: boolean): Promise<string> {
  const target = avoidOverwrite && taken(dest) ? uniquePath(dirname(dest), basename(dest)) : dest
  try {
    await rename(staged, target)
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code !== 'EXDEV') throw err
    await copyFile(staged, target)
    await unlink(staged)
  }
  return target
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
  let closed = false
  let decide: (savePath: string | null) => void = () => {}
  const decision = new Promise<string | null>((resolve) => {
    decide = resolve
  })

  // `done` se registra ya, para no perder uno temprano (p. ej. la página cancela la descarga mientras se espera la decisión).
  item.once('done', (_e, state) => {
    void (async () => {
      closed = true
      if (state !== 'completed') {
        cleanStaging()
        decide(null)
        return
      }
      const savePath = await decision
      if (!savePath) {
        cleanStaging()
        return
      }
      const staged = join(staging, fileName)
      let finalPath: string | null = null
      try {
        if (owner.kind === 'tasks' && dirname(savePath) === dir) {
          finalPath = await moveDownloadIntoTaskFolder(staged, owner.folder, dir, basename(savePath))
        } else {
          finalPath = await moveDownloadToPath(staged, savePath, attribution.agent)
        }
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
    if (closed) {
      // La descarga ya terminó (o se canceló) mientras se decidía: `done` se encarga de limpiar.
      decide(null)
      return
    }
    if (!savePath) {
      decide(null)
      item.cancel()
      cleanStaging()
      return
    }
    decide(savePath)
    item.resume()
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
