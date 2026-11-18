import { app, net } from 'electron'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { VideoEnsureResult, VideoInstallResult, VideoSnapshot } from '@shared/video'
import { createManualFetch, type NetLike } from '../remote/tunnel/manual-fetch'
import { RuntimeError, toRuntimeError, type RuntimeErrorCode } from '../runtimes/runtime-install'
import { runtimesService } from '../runtimes/service'
import { unpacked } from '../util/asar'
import { asegurarPiezasVideo, cleanupVideo, installVideo, removeVideo, videoPaths, videoStatus, type VideoDeps } from './install'
import { parseVideoPin } from './video-pin'

export class VideoService {
  private controller: AbortController | null = null
  private operation: Promise<VideoInstallResult> | null = null
  private removing = false
  private progress: VideoSnapshot['progress']
  private error: string | undefined

  constructor(private readonly deps: () => VideoDeps) {}

  estado(): VideoSnapshot {
    return { ...videoStatus(this.deps()), installing: this.controller !== null, progress: this.progress, error: this.error }
  }
  rutas(): ReturnType<typeof videoPaths> {
    return videoPaths(this.deps())
  }
  asegurarPiezasVideo(): VideoEnsureResult {
    return asegurarPiezasVideo(this.deps())
  }

  instalar(): Promise<VideoInstallResult> {
    if (this.operation) return this.operation
    if (this.removing) return Promise.resolve({ ok: false, error: 'busy' })
    const controller = new AbortController()
    this.controller = controller
    this.error = undefined
    this.operation = Promise.resolve().then(async (): Promise<VideoInstallResult> => {
      try {
        const d = this.deps()
        await cleanupVideo(d.videoDir)
        await installVideo(
          d,
          (p) => {
            this.progress = p
          },
          controller.signal
        )
        return { ok: true }
      } catch (e) {
        this.error = toRuntimeError(e).code
        return { ok: false, error: this.error }
      } finally {
        this.controller = null
        this.operation = null
        this.progress = undefined
      }
    })
    return this.operation
  }
  cancelar(): void {
    this.controller?.abort()
  }
  async quitar(): Promise<void> {
    if (this.operation || this.removing) throw new RuntimeError('busy')
    this.removing = true
    try {
      await removeVideo(this.deps())
      this.error = undefined
    } finally {
      this.removing = false
    }
  }
}

function appDeps(): VideoDeps {
  const candidates = [app.getAppPath(), join(__dirname, '..', '..')].map((b) => unpacked(join(b, 'resources', 'video')))
  const resourcesDir = candidates.find((c) => existsSync(join(c, 'pin.json'))) ?? candidates[0]!
  let pin: VideoDeps['pin'] = null
  try {
    pin = parseVideoPin(JSON.parse(readFileSync(join(resourcesDir, 'pin.json'), 'utf8')))
  } catch {
    /* falla cerrado */
  }
  const runtime = runtimesService()
  return {
    videoDir: join(app.getPath('userData'), 'video'),
    resourcesDir,
    pin,
    fetch: createManualFetch(net as unknown as NetLike),
    node: () => {
      const state = runtime.check().node
      return {
        paths: state.state === 'installed' && state.npmCli ? { bin: state.bin, npmCli: state.npmCli } : null,
        missingBytes: state.state === 'missing' || state.state === 'broken' ? state.sizeBytes : 0,
        version: runtime.deps().pin?.node.version ?? ''
      }
    },
    ensureNode: async (progress, signal) => {
      const result = await runtime.installNodeNow((p) => progress(p.done ?? 0, p.total ?? 0), signal)
      if (!result.ok) throw new RuntimeError(result.error as RuntimeErrorCode)
      const bins = runtime.bins()
      if (!bins.node || !bins.npmCli) throw new RuntimeError('broken', 'node')
      return { bin: bins.node, npmCli: bins.npmCli }
    }
  }
}

let instance: VideoService | undefined
export const videoService = (): VideoService => (instance ??= new VideoService(appDeps))
/** Consulta del render MCP: jamás instala ni descarga sin consentimiento. */
export const asegurarPiezasVideoInstaladas = (): VideoEnsureResult => videoService().asegurarPiezasVideo()
