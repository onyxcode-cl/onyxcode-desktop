import { mkdtemp, mkdir, writeFile, readFile, cp, realpath, readdir } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { asegurarPiezasVideo, installVideo, type VideoDeps } from '../../src/main/video/install'
import { appRuntimeBins, installRuntimes, runtimesStatus, type RuntimeDeps } from '../../src/main/runtimes/runtime-install'
import { parseRuntimePin } from '../../src/main/runtimes/runtime-pin'
import { parseVideoPin } from '../../src/main/video/video-pin'
import { VideoMcpServer } from '../../src/main/video/mcp-server'
import { createRenderProcess, renderEnvironment, type RenderProcess } from '../../src/main/video/render-process'

async function main(): Promise<void> {
  const arg = (key: string) => {
    const i = process.argv.indexOf(key)
    return i >= 0 ? process.argv[i + 1] : undefined
  }
  const project = arg('--project')
  if (!project) throw Error('--project obligatorio')
  const diagnostic = process.argv.includes('--diagnostic-without-seatbelt')
  if (diagnostic && process.platform !== 'darwin') throw Error('El diagnóstico sin Seatbelt es solo para Mac; Windows usa su camino real.')
  const work = await mkdtemp(join(tmpdir(), 'lzx-video-render-real-'))
  const userData = join(work, 'userData')
  await mkdir(userData)
  if (!process.argv.includes('--node')) {
    const { app } = await import('electron')
    app.setPath('userData', userData)
    await app.whenReady()
  }
  const reuse = arg('--installed-user-data')
  if (reuse) {
    const source = await realpath(reuse),
      temp = await realpath(tmpdir())
    if (!source.startsWith(temp + sep) || !source.includes('lzx-video-'))
      throw Error('Solo se reutilizan piezas de un userData TEMPORAL de la prueba de video.')
    await cp(join(source, 'video'), join(userData, 'video'), { recursive: true })
    await cp(join(source, 'runtimes'), join(userData, 'runtimes'), { recursive: true })
  }
  const repo = resolve(__dirname, '../..'),
    resources = join(repo, 'resources')
  const runtime: RuntimeDeps = {
    runtimesDir: join(userData, 'runtimes'),
    pin: parseRuntimePin(JSON.parse(readFileSync(join(resources, 'runtimes/pin.json'), 'utf8'))),
    fetch: (u, i) => fetch(u, { ...i, redirect: 'manual' })
  }
  const node = () => {
    const bins = appRuntimeBins(runtime),
      state = runtimesStatus(runtime).node
    return {
      paths: bins.node && bins.npmCli ? { bin: bins.node, npmCli: bins.npmCli } : null,
      missingBytes: state.state === 'missing' || state.state === 'broken' ? state.sizeBytes : 0,
      version: runtime.pin!.node.version
    }
  }
  const deps: VideoDeps = {
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
  const pieces = asegurarPiezasVideo(deps)
  if (pieces.state !== 'ready') {
    if (!process.argv.includes('--install')) throw Error('Faltan piezas: pasa --install para consentir su instalación EN ESTE TEMPORAL.')
    await installVideo(deps, (p) => console.log('instalación', p))
  }
  const folder = join(work, 'conversation')
  await mkdir(join(folder, 'promo'), { recursive: true })
  await cp(join(project, 'hyperframes/15-vertical/index.html'), join(folder, 'promo/index.html'))
  const worker = join(resources, 'video/render-worker.mjs')
  const children = new Set<ReturnType<typeof spawn>>()
  const ownGroups: number[] = []
  const ownPids: number[] = []
  const diagnosticRender: RenderProcess = (job, signal) =>
    new Promise((done, reject) => {
      const child = spawn(job.node, [worker, JSON.stringify(job)], {
        cwd: job.work,
        env: renderEnvironment(job.work, job.paths),
        stdio: ['pipe', 'pipe', 'pipe'],
        detached: process.platform !== 'win32'
      })
      children.add(child)
      if (child.pid) ownGroups.push(child.pid)
      const kill = () => {
        if (child.pid) {
          try {
            process.kill(-child.pid, 'SIGKILL')
          } catch {}
        }
      }
      const abort = () => kill()
      signal.addEventListener('abort', abort, { once: true })
      if (signal.aborted) kill()
      let stdout = '',
        stderr = ''
      child.stdout!.on('data', (b) => {
        stdout += b
      })
      child.stderr!.on('data', (b) => {
        stderr += b
      })
      child.once('error', reject)
      child.once('close', (code) => {
        signal.removeEventListener('abort', abort)
        kill()
        children.delete(child)
        if (code !== 0) reject(Error(stderr))
        else {
          try {
            const parsed = JSON.parse(stdout)
            ownPids.push(...(parsed.ownedPids ?? []))
            done(parsed)
          } catch (e) {
            reject(e)
          }
        }
      })
    })
  const server = new VideoMcpServer({
    privateDir: join(userData, 'video-render-tmp'),
    pieces: () => asegurarPiezasVideo(deps),
    node: () => node().paths?.bin ?? null,
    consent: async () => false,
    install: async () => {
      throw Error('No instalar desde MCP en esta prueba')
    },
    render: diagnostic
      ? diagnosticRender
      : async (job, signal) => {
          const out = await createRenderProcess(worker)(job, signal)
          ownPids.push(...(out.ownedPids ?? []))
          return out
        }
  })
  let hits = 0
  const canary = createServer((_req, res) => {
    hits++
    res.end('outside local service')
  })
  await new Promise<void>((done) => canary.listen(0, '127.0.0.1', done))
  const canaryUrl = `http://127.0.0.1:${(canary.address() as { port: number }).port}/canary`
  await (await fetch(canaryUrl)).text()
  if (hits !== 1) throw Error('Local canary was not reachable')
  hits = 0
  const canaryFile = join(work, 'private-canary.txt')
  await writeFile(canaryFile, 'PRIVATE_CANARY_OUTSIDE_COMPOSITION')
  const fileUrl = pathToFileURL(canaryFile).href
  await mkdir(join(folder, 'hostile'))
  await writeFile(
    join(folder, 'hostile/index.html'),
    `<!doctype html><meta charset="utf-8"><script src="../node_modules/gsap/dist/gsap.min.js"></script><div id="probe" data-composition-id="main" data-start="0" data-duration="2" data-width="1080" data-height="1920">Prueba de red y archivo</div><script>
    document.body.style.background = 'rgb(255,0,0)'; document.body.style.margin = '0';
    const timeline = gsap.timeline({paused:true}); timeline.to({}, {duration:2}); window.__timelines = {main:timeline};
    const probe = Promise.all(${JSON.stringify(['https://example.com/lazunox-video-network-probe', canaryUrl, fileUrl])}.map(async url => { try { await fetch(url, {mode:'no-cors'}); return false } catch { return true } })).then(blocked => {
      document.body.style.background = blocked.length === 3 && blocked.every(x => x === true) ? 'rgb(0,255,0)' : 'rgb(255,0,0)';
    });
    window.__hf = window.__hf || {}; window.__hf.buildReady = {network:probe};
  </script>`
  )
  const { token, port } = await server.clientFor({ folder })
  const call = async (name: string, args: Record<string, unknown>) => {
    const t0 = performance.now()
    const response = await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
      signal: AbortSignal.timeout(360000)
    })
    const rpc = await response.json()
    if (!response.ok || rpc.error || rpc.result?.isError) throw Error(JSON.stringify(rpc))
    return {
      ms: performance.now() - t0,
      text: JSON.parse(rpc.result.content.find((c: { type: string }) => c.type === 'text').text),
      images: rpc.result.content.filter((c: { type: string }) => c.type === 'image').length
    }
  }
  const report: Record<string, unknown> = {
    work,
    userData,
    platform: process.platform,
    runtime: process.argv.includes('--node') ? 'Node' : 'Electron',
    seatbelt: !diagnostic && process.platform === 'darwin',
    diagnosticOnly: diagnostic
  }
  try {
    report.cuadros = await call('cuadros', { composicion: 'promo/index.html', formato: 'vertical', segundos: [2.5, 7.5, 12.5] })
    report.cuadrosWarm = await call('cuadros', { composicion: 'promo/index.html', formato: 'vertical', segundos: [2.5, 7.5, 12.5] })
    report.red = await call('cuadros', { composicion: 'hostile/index.html', formato: 'vertical', segundos: [1] })
    const proof = (report.red as { text: { cuadros: string[] } }).text.cuadros[0]
    const ready = asegurarPiezasVideo(deps)
    if (ready.state !== 'ready') throw Error('pieces missing')
    const pixel = await new Promise<Buffer>((done, reject) => {
      const ff = spawn(
        ready.paths.ffmpeg,
        ['-v', 'error', '-i', proof, '-vf', 'crop=1:1:0:0,format=rgb24', '-frames:v', '1', '-f', 'rawvideo', 'pipe:1'],
        { stdio: ['ignore', 'pipe', 'pipe'] }
      )
      const chunks: Buffer[] = []
      ff.stdout.on('data', (b) => chunks.push(b))
      ff.stderr.resume()
      ff.on('error', reject)
      ff.on('close', (code) => (code === 0 ? done(Buffer.concat(chunks)) : reject(Error('Probe PNG decode failed'))))
    })
    if (pixel.toString('hex') !== '00ff00')
      throw Error('Hostile composition did not confirm all three fetch failures: ' + pixel.toString('hex'))
    report.networkProbePixel = pixel.toString('hex')
    if (hits !== 0) throw Error(`Composition reached the local canary ${hits} times`)
    report.localCanaryHits = hits
    report.render = await call('render', {
      composicion: 'promo/index.html',
      formato: 'vertical',
      duracion: 15,
      fps: 30,
      nombre: 'v32-render-15-vertical'
    })
    const cancellationStarted = performance.now()
    const controller = new AbortController()
    const cancelTimer = setTimeout(() => controller.abort(), 1000)
    let cancelled = false
    try {
      await fetch(`http://127.0.0.1:${port}/mcp`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 2,
          method: 'tools/call',
          params: {
            name: 'render',
            arguments: { composicion: 'promo/index.html', formato: 'vertical', duracion: 15, fps: 30, nombre: 'cancelled' }
          }
        }),
        signal: controller.signal
      })
    } catch {
      cancelled = controller.signal.aborted
    } finally {
      clearTimeout(cancelTimer)
    }
    if (!cancelled) throw Error('Cancellation test did not abort an active MCP call')
    const until = Date.now() + 5000
    while ((await readdir(join(userData, 'video-render-tmp'))).length && Date.now() < until)
      await new Promise((done) => setTimeout(done, 50))
    report.cancellationMs = performance.now() - cancellationStarted
    const alive = (pid: number) => {
      try {
        process.kill(pid, 0)
        return true
      } catch {
        return false
      }
    }
    report.ownedDirectPidsLeft = ownPids.filter(alive)
    report.ownedGroupsLeft =
      process.platform === 'win32'
        ? 'not applicable'
        : diagnostic
          ? ownGroups.filter((pid) => alive(-pid))
          : 'not captured by production adapter'
    if ((report.ownedDirectPidsLeft as number[]).length || (Array.isArray(report.ownedGroupsLeft) && report.ownedGroupsLeft.length))
      throw Error('Owned render processes remain alive')
    report.temporaryRendersLeft = await readdir(join(userData, 'video-render-tmp'))
    report.childrenLeft = children.size
    if (children.size || (report.temporaryRendersLeft as string[]).length) throw Error('Cancellation did not clean the render')
    report.ok = true
  } catch (error) {
    report.ok = false
    report.error = error instanceof Error ? error.message : String(error)
    process.exitCode = 1
  } finally {
    await server.stop()
    await new Promise<void>((done) => canary.close(() => done()))
    const reportFile = arg('--report') ?? join(work, 'report.json')
    await writeFile(reportFile, JSON.stringify(report, null, 2))
    console.log(JSON.stringify(report, null, 2))
    if (!process.argv.includes('--node')) {
      const { app } = await import('electron')
      app.exit(process.exitCode ?? 0)
    }
  }
}
void main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
