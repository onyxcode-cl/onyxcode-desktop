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
import { constants as fsc, copyFileSync, lstatSync, mkdirSync, mkdtempSync, renameSync, rmSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { app, dialog, type DownloadItem, type WebContents } from 'electron'
import { INTERNAL_NAME } from '@shared/brand'
import type { BrowserOwner } from '@shared/ipc-browser'
import { migrateFolderScratch } from '../migrations/migrate-folder-scratch'
import { ensureRealDir } from '../tasks/no-follow'
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
 * Descargas a la carpeta de una TAREA (1.8.18): la tarea controla `<carpeta>/.lazunox/trabajo/descargas` desde dentro del encierro y
 * podía dejar ahí enlaces (la carpeta entera, el nombre del archivo o el temporal `<nombre>.crdownload` que usa Chromium) hacia, por
 * ejemplo, `~/Library/LaunchAgents`: el proceso principal escribía la descarga a través del enlace, fuera del encierro. Ahora Chromium
 * descarga en una carpeta de `userData` (ilegible e inescribible desde dentro) y al terminar el archivo se mueve a la carpeta de la tarea
 * con la ruta comprobada tramo a tramo (sin enlaces) y con un nombre libre (`rename`, que nunca sigue un enlace en el destino).
 */
export function stagingDirForTaskDownload(userData: string): string {
  const base = join(userData, 'descargas-pendientes')
  mkdirSync(base, { recursive: true, mode: 0o700 })
  return mkdtempSync(join(base, 'd-'))
}

/** Mueve la descarga terminada a la carpeta de descargas de la tarea sin seguir enlaces. Devuelve la ruta final, o null si no se pudo. */
export function moveDownloadIntoTaskFolder(staged: string, folder: string, dir: string, name: string): string | null {
  try {
    ensureRealDir(folder, dir, { create: true })
    for (let i = 0; i < 20; i++) {
      const final = uniquePath(dir, name)
      try {
        renameSync(staged, final)
        return final
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code
        if (code === 'EXDEV') {
          // Otro volumen: copia exclusiva (`O_EXCL`: falla si hay cualquier cosa con ese nombre, enlace incluido).
          copyFileSync(staged, final, fsc.COPYFILE_EXCL)
          rmSync(staged, { force: true })
          return final
        }
        if (code !== 'EEXIST' && code !== 'EISDIR' && code !== 'ENOTEMPTY') throw err
      }
    }
    return null
  } catch (err) {
    console.warn('[embedded-browser] no se pudo dejar la descarga en la carpeta de la tarea (¿hay un enlace en el camino?):', err)
    return null
  }
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
  item.pause()

  const finish = (savePath: string | null): void => {
    if (!savePath) {
      item.cancel()
      return
    }
    // Tareas, destino dentro de su carpeta de descargas: Chromium escribe en una carpeta de la app y luego se mueve (ver arriba).
    const staged =
      owner.kind === 'tasks' && dirname(savePath) === dir
        ? join(stagingDirForTaskDownload(app.getPath('userData')), basename(savePath))
        : null
    item.setSavePath(staged ?? savePath)
    item.resume()
    item.once('done', (_e, state) => {
      let finalPath: string | null = item.getSavePath()
      if (staged) {
        finalPath =
          state === 'completed' && owner.kind === 'tasks' ? moveDownloadIntoTaskFolder(staged, owner.folder, dir, basename(savePath)) : null
        rmSync(dirname(staged), { recursive: true, force: true })
      }
      if (state !== 'completed' || !finalPath) return
      if (attribution.agent) applyQuarantine(finalPath)
      void applyZoneIdentifier(finalPath, item.getURL())
    })
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
    }).then((decision) => finish(decision === 'allow' ? uniquePath(dir, fileName) : null))
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
