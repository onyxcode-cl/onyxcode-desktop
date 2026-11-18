/** Alternativa explícita para aislamientos donde Electron aborta antes de iniciar JavaScript. Mismo instalador, fetch de Node. */
import { mkdtemp, mkdir } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { asegurarPiezasVideo, installVideo, videoPaths, videoStatus, type VideoDeps } from '../../src/main/video/install'
import { appRuntimeBins, installRuntimes, runtimesStatus, type RuntimeDeps } from '../../src/main/runtimes/runtime-install'
import { parseRuntimePin } from '../../src/main/runtimes/runtime-pin'
import { parseVideoPin } from '../../src/main/video/video-pin'
import { runSmoke } from './smoke-run'

async function main(): Promise<void> {
  const arg = (key: string): string | undefined => {
    const i = process.argv.indexOf(key)
    return i >= 0 ? process.argv[i + 1] : undefined
  }
  const project = arg('--project')
  if (!project) throw new Error('--project obligatorio')
  const work = await mkdtemp(join(tmpdir(), 'lzx-video-node-real-'))
  const userData = join(work, 'userData')
  await mkdir(userData)
  const resources = join(__dirname, '../../resources')
  const runtime: RuntimeDeps = {
    runtimesDir: join(userData, 'runtimes'),
    pin: parseRuntimePin(JSON.parse(readFileSync(join(resources, 'runtimes/pin.json'), 'utf8'))),
    fetch: (u, i) => fetch(u, { ...i, redirect: 'manual' })
  }
  const node = () => {
    const bins = appRuntimeBins(runtime)
    const state = runtimesStatus(runtime).node
    return {
      paths: bins.node && bins.npmCli ? { bin: bins.node, npmCli: bins.npmCli } : null,
      version: runtime.pin!.node.version,
      missingBytes: state.state === 'missing' || state.state === 'broken' ? state.sizeBytes : 0
    }
  }
  const d: VideoDeps = {
    videoDir: join(userData, 'video'),
    resourcesDir: join(resources, 'video'),
    pin: parseVideoPin(JSON.parse(readFileSync(join(resources, 'video/pin.json'), 'utf8'))),
    fetch: runtime.fetch,
    node,
    ensureNode: async (progress, signal) => {
      await installRuntimes(runtime, (p) => progress(p.done ?? 0, p.total ?? 0), signal, ['node'])
      return node().paths!
    }
  }
  let progress: ReturnType<typeof videoStatus>['progress']
  await runSmoke(
    {
      asegurarPiezasVideo: () => asegurarPiezasVideo(d),
      estado: () => ({ ...videoStatus(d), progress }),
      rutas: () => videoPaths(d),
      instalar: async () => {
        await installVideo(d, (p) => {
          progress = p
        })
        return { ok: true }
      }
    },
    () => node().paths?.bin ?? null,
    userData,
    work,
    project,
    arg('--report')
  )
}
void main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
