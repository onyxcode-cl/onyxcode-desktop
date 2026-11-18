/** Integración en main: consentimiento nativo y progreso visible; sin descargas desde las herramientas de la IA. */
import { app, BrowserWindow } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { t } from '@shared/i18n'
import { videoMb } from '@shared/video'
import { askVideoInstall } from './consent'
import { unpacked } from '../util/asar'
import { runtimesService } from '../runtimes/service'
import { videoService } from './service'
import { VideoMcpServer } from './mcp-server'
import { createRenderProcess } from './render-process'

async function install(signal: AbortSignal): Promise<void> {
  signal.throwIfAborted()
  const service = videoService()
  // Otro consentimiento/instalación mantiene la propiedad de su cancelación.
  if (service.estado().installing) throw new Error(t('settings.video.installingElsewhere'))
  const window = new BrowserWindow({
    width: 480,
    height: 200,
    useContentSize: true,
    resizable: false,
    minimizable: false,
    maximizable: false,
    title: t('settings.video.progressTitle'),
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, devTools: false }
  })
  window.setMenu(null)
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event) => event.preventDefault())
  const escape = (s: string): string =>
    s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
  void window.loadURL(
    `data:text/html;charset=utf-8,${encodeURIComponent(`<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><body style="box-sizing:border-box;margin:0;padding:24px;font:16px/1.5 system-ui;overflow-wrap:anywhere"><p style="margin:0">${escape(t('settings.video.progressDetail'))}</p></body>`)}`
  )
  const cancel = (): void => service.cancelar()
  signal.addEventListener('abort', cancel, { once: true })
  window.on('close', cancel)
  const phases = {
    node: 'settings.video.phase.node',
    download: 'settings.runtimes.phase.download',
    extract: 'settings.runtimes.phase.extract',
    npm: 'settings.video.phase.npm',
    verify: 'settings.runtimes.phase.verify',
    done: 'settings.runtimes.phase.done'
  } as const
  const timer = setInterval(() => {
    if (window.isDestroyed()) return
    const p = service.estado().progress
    const fraction = p?.total ? Math.min(1, (p.done ?? 0) / p.total) : -1
    window.setProgressBar(fraction)
    window.setTitle(`${t(p ? phases[p.phase] : 'settings.video.progressTitle')}${fraction >= 0 ? ` · ${Math.round(fraction * 100)}%` : ''}`)
  }, 250)
  try {
    if (signal.aborted) return
    const result = await service.instalar()
    if (!result.ok) throw new Error(t('settings.video.installFailed'))
  } finally {
    clearInterval(timer)
    signal.removeEventListener('abort', cancel)
    window.removeListener('close', cancel)
    if (!window.isDestroyed()) window.destroy()
  }
}

let instance: VideoMcpServer | undefined
export function videoMcpServer(): VideoMcpServer {
  const candidates = [app.getAppPath(), join(__dirname, '..', '..')].map((p) => unpacked(join(p, 'resources/video/render-worker.mjs')))
  return (instance ??= new VideoMcpServer({
    privateDir: join(app.getPath('userData'), 'video-render-tmp'),
    pieces: () => videoService().asegurarPiezasVideo(),
    node: () => runtimesService().bins().node ?? null,
    consent: async (bytes, signal) =>
      (await askVideoInstall({
        message: t('settings.video.consentTitle'),
        detail: `${t('settings.video.desc')}\n\n${t('settings.video.chrome')}\n${t('settings.video.gpl')}`,
        buttons: [t('settings.video.later'), t('settings.video.consentInstall', { mb: videoMb(bytes) })],
        defaultIndex: 0,
        cancelIndex: 0,
        signal
      })) === 1 && !signal.aborted,
    install,
    photo: async (root, session, chat, origin) => {
      const { documentPhotoRegistry, chatPhotosMcp } = await import('../documents')
      const scope = chat && session ? await chatPhotosMcp.rootFor(session) : root
      const id = origin.replace(/^imagen:/, '')
      const photo = (await documentPhotoRegistry.findId(scope, id)) ?? (await documentPhotoRegistry.findPath(scope, origin))
      return photo?.asset.bytes ?? null
    },
    render: createRenderProcess(candidates.find(existsSync) ?? candidates[0]!)
  }))
}
