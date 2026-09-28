/**
 * Ventana de artifacts: renderiza HTML generado por el modelo en un BrowserWindow aislado.
 *
 * Capas de aislamiento:
 * - Sesión propia en memoria (`partition: 'artifact'`, sin `persist:`): no comparte cookies,
 *   storage ni caché con la app.
 * - Sin preload, `sandbox`, `contextIsolation`, sin `nodeIntegration`.
 * - Se sirve desde un esquema propio con cabecera CSP estricta (y además un <meta> CSP
 *   inyectado): sólo scripts/estilos inline, imágenes/fuentes data:/blob:, sin red.
 * - webRequest cancela cualquier petición http(s)/ws/file desde esa sesión; permisos denegados;
 *   navegación y ventanas nuevas bloqueadas.
 */
import { app, BrowserWindow, clipboard, dialog, Menu, session, type Session } from 'electron'
import { writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { APP_SLUG } from '@shared/brand'
import type { ArtifactPayload } from '@shared/ipc-extras'
import { extrasWindows } from './windows'

const PARTITION = 'artifact'
const SCHEME = `${APP_SLUG}-artifact`
const MAX_HTML_BYTES = 5 * 1024 * 1024

export const ARTIFACT_CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline'",
  'img-src data: blob:',
  'font-src data:',
  'media-src data: blob:',
  "connect-src 'none'",
  "frame-src 'none'",
  "worker-src 'none'",
  "object-src 'none'",
  "form-action 'none'",
  "base-uri 'none'"
].join('; ')

const artifacts = new Map<string, ArtifactPayload>()
let configuredSession: Session | null = null

function artifactSession(): Session {
  if (configuredSession) return configuredSession
  const ses = session.fromPartition(PARTITION, { cache: false })

  ses.protocol.handle(SCHEME, (request) => {
    const id = request.url.slice(`${SCHEME}://`.length).replace(/[/?#].*$/, '')
    const artifact = artifacts.get(id)
    if (!artifact) return new Response('Artifact no encontrado', { status: 404 })
    return new Response(withCspMeta(artifact.html, artifact.title), {
      status: 200,
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'content-security-policy': ARTIFACT_CSP,
        'x-content-type-options': 'nosniff',
        'cache-control': 'no-store'
      }
    })
  })

  ses.webRequest.onBeforeRequest((details, callback) => {
    const blocked = /^(https?|wss?|file|ftp):/i.test(details.url)
    callback({ cancel: blocked })
  })
  ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false))
  ses.setPermissionCheckHandler(() => false)
  ses.on('will-download', (event) => event.preventDefault())

  configuredSession = ses
  return ses
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c)
}

/** Antepone el <meta> CSP (el parser lo sube al <head> como primer elemento). */
function withCspMeta(html: string, title: string): string {
  const meta = `<meta http-equiv="Content-Security-Policy" content="${ARTIFACT_CSP}">`
  const hasDoc = /<html[\s>]/i.test(html) || /<!doctype/i.test(html)
  if (hasDoc) {
    const doctype = html.match(/^\s*<!doctype[^>]*>/i)?.[0] ?? ''
    return `${doctype || '<!doctype html>'}${meta}${html.slice(doctype.length)}`
  }
  // Fragmento: envolverlo en un documento mínimo.
  return `<!doctype html><html lang="es"><head>${meta}<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(title)}</title></head><body>${html}</body></html>`
}

export function openArtifact(payload: ArtifactPayload): BrowserWindow {
  const html = String(payload.html ?? '')
  if (Buffer.byteLength(html, 'utf8') > MAX_HTML_BYTES) throw new Error('El HTML del artifact supera 5 MB.')
  const title = (payload.title ?? '').trim() || 'Artifact'
  const id = randomUUID()
  artifacts.set(id, { title, html })

  const win = new BrowserWindow({
    width: 960,
    height: 720,
    minWidth: 360,
    minHeight: 240,
    title,
    show: false,
    backgroundColor: '#ffffff',
    webPreferences: {
      session: artifactSession(),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInSubFrames: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
      spellcheck: false,
      devTools: !app.isPackaged
    }
  })
  extrasWindows.add(win)
  const wc = win.webContents

  wc.setWindowOpenHandler(() => ({ action: 'deny' }))
  wc.on('will-navigate', (event, url) => {
    if (url !== wc.getURL()) event.preventDefault()
  })
  wc.on('will-redirect', (event) => event.preventDefault())
  wc.on('will-attach-webview', (event) => event.preventDefault())
  // Mantener el título elegido aunque el HTML tenga su propio <title>.
  win.on('page-title-updated', (event) => event.preventDefault())
  win.once('ready-to-show', () => win.show())
  win.on('closed', () => artifacts.delete(id))

  wc.on('context-menu', () => {
    const artifact = artifacts.get(id)
    Menu.buildFromTemplate([
      { label: 'Recargar', click: () => wc.reload() },
      { type: 'separator' },
      { label: 'Copiar código HTML', click: () => artifact && clipboard.writeText(artifact.html) },
      {
        label: 'Guardar como HTML…',
        click: () => {
          if (!artifact) return
          void (async () => {
            const safe = title.replace(/[^\p{L}\p{N} _-]+/gu, '').trim() || 'artifact'
            const res = await dialog.showSaveDialog(win, {
              title: 'Guardar artifact',
              defaultPath: `${safe}.html`,
              filters: [{ name: 'HTML', extensions: ['html', 'htm'] }]
            })
            if (!res.canceled && res.filePath) await writeFile(res.filePath, artifact.html, 'utf8')
          })().catch((err: unknown) => dialog.showErrorBox('No se pudo guardar', String(err)))
        }
      },
      ...(app.isPackaged
        ? []
        : [{ type: 'separator' as const }, { label: 'Inspeccionar', click: () => wc.openDevTools({ mode: 'detach' }) }])
    ]).popup({ window: win })
  })

  void win.loadURL(`${SCHEME}://${id}`)
  return win
}
