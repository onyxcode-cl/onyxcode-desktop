/**
 * Descargas del navegador integrado (Lote D, B.9 y D1 paso 7).
 *
 * - Del agente: se pausan, se pide aprobación (tarjeta `kind:'download'`, B.8) con nombre y
 *   destino; si se aprueba, se guardan y se marca con `com.apple.quarantine` (D0 corrección 4:
 *   Electron NO pone esa marca sola en macOS, así que si queremos que Gatekeeper avise antes de
 *   abrir un archivo que trajo el agente, hay que añadirla a mano con `xattr`).
 * - Del usuario: diálogo de guardado nativo (`dialog.showSaveDialog`), como el resto de la app.
 * - Nunca se abren solas (ni `shell.openPath` ni nada parecido aquí).
 * - Destinos: Tareas → `<carpeta>/.onyxcode/trabajo/descargas/`; Code → `~/Downloads/<APP_NAME>/`.
 */
import { execFile } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { dialog, type DownloadItem, type WebContents } from 'electron'
import { APP_NAME } from '@shared/brand'
import type { BrowserOwner } from '@shared/ipc-browser'
import { migrateFolderScratch } from '../migrations/migrate-folder-scratch'
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
  if (owner.kind === 'tasks') return join(owner.folder, '.onyxcode', 'trabajo', 'descargas')
  return join(homedir(), 'Downloads', APP_NAME)
}

/** Nombre de archivo simple, sin separadores de ruta ni bytes nulos (defensa adicional a Electron). */
function sanitizeFileName(name: string): string {
  const base = name.replace(/[/\\\0]/g, '_').trim()
  return base || 'descarga'
}

function uniquePath(dir: string, name: string): string {
  let candidate = join(dir, name)
  if (!existsSync(candidate)) return candidate
  const dot = name.lastIndexOf('.')
  const stem = dot > 0 ? name.slice(0, dot) : name
  const ext = dot > 0 ? name.slice(dot) : ''
  for (let i = 2; i < 1000; i++) {
    candidate = join(dir, `${stem} (${i})${ext}`)
    if (!existsSync(candidate)) return candidate
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
  const value = `0083;${stamp};${APP_NAME};`
  execFile('/usr/bin/xattr', ['-w', 'com.apple.quarantine', value, filePath], (err) => {
    if (err) console.warn('[embedded-browser] no se pudo poner com.apple.quarantine:', err)
  })
}

function ownerOf(wc: WebContents): BrowserOwner | null {
  return tabByWebContents(wc)?.owner ?? null
}

export function handleWillDownload(event: Electron.Event, item: DownloadItem, wc: WebContents): void {
  const owner = ownerOf(wc)
  if (!owner || !deps) {
    console.warn('[embedded-browser] descarga sin owner reconocido: cancelada')
    event.preventDefault()
    return
  }
  const dir = destinationDir(owner)
  // Migra la carpeta de trabajo heredada a `.onyxcode/trabajo/` antes de escribir.
  if (owner.kind === 'tasks') migrateFolderScratch(owner.folder, (m, e) => console.warn('[embedded-browser]', m, e ?? ''))
  try {
    mkdirSync(dir, { recursive: true })
  } catch (err) {
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
    item.setSavePath(savePath)
    item.resume()
    item.once('done', (_e, state) => {
      if (state === 'completed' && attribution.agent) applyQuarantine(item.getSavePath())
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
