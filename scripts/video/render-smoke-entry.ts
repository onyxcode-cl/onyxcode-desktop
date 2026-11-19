import { mkdtemp, mkdir, writeFile, cp, realpath, readdir, rm } from 'node:fs/promises'
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
import { qualityComposition } from '../../src/main/video/fixtures/quality'
import { parseRenderError } from '../../src/main/video/render-errors'
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
  const compositionProject = arg('--composition-project')
  if (compositionProject) {
    for (const name of ['index.html', 'compositions', 'assets'])
      await cp(join(compositionProject, name), join(folder, 'promo', name), { recursive: true })
  } else await cp(join(project, 'hyperframes/15-vertical/index.html'), join(folder, 'promo/index.html'))
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
        if (code !== 0) {
          let failure: Error = Error(stderr)
          try {
            failure = parseRenderError(JSON.parse(stdout)) ?? failure
          } catch {
            /* sandbox error */
          }
          reject(failure)
        } else {
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
          const launcher = process.platform === 'darwin' ? (await import('../../src/main/video/render-seatbelt')).seatbeltLaunch : undefined
          const out = await createRenderProcess(worker, launcher)(job, signal)
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
  const call = async (name: string, args: Record<string, unknown>, expectedError?: string) => {
    const t0 = performance.now()
    const response = await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
      signal: AbortSignal.timeout(360000)
    })
    const body = await response.text()
    const rpc = JSON.parse(body)
    if (expectedError) {
      const error = rpc.result?.content?.find((c: { type: string }) => c.type === 'text')?.text
      if (!rpc.result?.isError || !error?.includes(expectedError)) throw Error(JSON.stringify(rpc))
      return { error, ms: performance.now() - t0 }
    }
    if (!response.ok || rpc.error || rpc.result?.isError) throw Error(JSON.stringify(rpc))
    return {
      ms: performance.now() - t0,
      responseBytes: Buffer.byteLength(body),
      text: JSON.parse(rpc.result.content.find((c: { type: string }) => c.type === 'text').text),
      images: rpc.result.content.filter((c: { type: string }) => c.type === 'image').length,
      imageBytes: rpc.result.content
        .filter((c: { type: string }) => c.type === 'image')
        .map((c: { data: string }) => Buffer.from(c.data, 'base64').length)
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
    if (process.argv.includes('--quality-step10')) {
      // Un hueco corto fuera de los segundos solicitados; repetir no debe ocultarlo.
      const gap = qualityComposition('clean')
        .replace(
          '</div><script',
          '<div id="cover" style="position:absolute;inset:0;background:#18251d;z-index:99;opacity:0"></div></div><script'
        )
        .replace('window.__timelines=', "tl.set('#cover',{opacity:1},5.3);tl.set('#cover',{opacity:0},5.4);window.__timelines=")
      await mkdir(join(folder, 'paso10'))
      await writeFile(join(folder, 'paso10/index.html'), gap)
      const first = await call('cuadros', { composicion: 'paso10/index.html', formato: 'vertical', segundos: [0, 2, 7] })
      const second = await call('cuadros', { composicion: 'paso10/index.html', formato: 'vertical', segundos: [1, 3, 8] })
      const final = await call('render', {
        composicion: 'paso10/index.html',
        formato: 'vertical',
        duracion: 9,
        fps: 30,
        nombre: 'hueco-persistente'
      })
      for (const checked of [first, second, final]) {
        if (!(checked.text.avisos as string[]).some((s) => s.includes('cuadro casi vacío'))) throw Error('Desapareció el hueco de 5.3 s')
      }
      if (!(final.text.avisos as string[]).some((s) => s.includes('MP4 final: cuadro casi vacío')))
        throw Error('Falta revisión del MP4 decodificado')
      if (!String(final.text.entrega).includes('no entregues como terminado sin decirlo')) throw Error('Falta advertencia de entrega')
      report.hueco = { first, second, final }
      // Ruido fijo a resolución completa: los seis originales deben superar 256 KiB.
      const noise = qualityComposition('clean')
        .replace('</div><script', '<canvas id="noise" width="1080" height="1920" style="position:absolute;inset:0"></canvas></div><script')
        .replace(
          'window.__timelines=',
          `
        const ctx=document.querySelector('canvas').getContext('2d'), pixels=ctx.createImageData(1080,1920);let seed=42;
        for(let i=0;i<pixels.data.length;i+=4){seed=(Math.imul(seed,1664525)+1013904223)>>>0;pixels.data[i]=seed&255;pixels.data[i+1]=(seed>>>8)&255;pixels.data[i+2]=(seed>>>16)&255;pixels.data[i+3]=255;}ctx.putImageData(pixels,0,0);
        window.__timelines=`
        )
      await mkdir(join(folder, 'ruido'))
      await writeFile(join(folder, 'ruido/index.html'), noise)
      const frames = await call('cuadros', { composicion: 'ruido/index.html', formato: 'vertical', segundos: [0, 1, 2, 3, 4, 8] })
      const attached = frames.text.adjuntos as { pedidos: number; enviados: number; noAdjuntados: string[] }
      if (frames.images !== 7 || attached.pedidos !== 7 || attached.enviados !== 7 || attached.noAdjuntados.length)
        throw Error('No llegaron los seis cuadros y la hoja')
      if (frames.imageBytes.some((n: number) => n > 256 * 1024)) throw Error('Adjunto sobre el tope del motor')
      const before = frames.text.imagenesOriginalesBytes as number[]
      if (!before || before.slice(0, 6).some((n) => n <= 256 * 1024)) throw Error('Los originales no superaban el tope de prueba')
      report.ruido = frames
      const evidence = arg('--evidence-dir')
      if (evidence) {
        await mkdir(evidence, { recursive: true })
        await cp(String(final.text.ruta), join(evidence, 'hueco-persistente.mp4'))
        await cp(String(second.text.hojaContactos), join(evidence, 'hueco-contactos.png'))
        for (const [i, frame] of (frames.text.cuadros as string[]).entries()) await cp(frame, join(evidence, `ruido-${i + 1}.png`))
        await cp(String(frames.text.hojaContactos), join(evidence, 'ruido-contactos.png'))
      }
      report.ownedDirectPidsLeft = ownPids.filter((pid) => {
        try {
          process.kill(pid, 0)
          return true
        } catch {
          return false
        }
      })
      report.childrenLeft = children.size
      report.temporaryRendersLeft = await readdir(join(userData, 'video-render-tmp'))
      if ((report.ownedDirectPidsLeft as number[]).length || children.size || (report.temporaryRendersLeft as string[]).length)
        throw Error('Quedan procesos o temporales propios')
      report.ok = true
      return
    }
    const quality: Record<string, unknown> = {}
    for (const kind of ['clean', 'overflow', 'overlap', 'gap', 'narrow'] as const) {
      await mkdir(join(folder, kind))
      await writeFile(join(folder, kind, 'index.html'), qualityComposition(kind))
      const review = await call('cuadros', { composicion: `${kind}/index.html`, formato: 'vertical', segundos: [1, 7] })
      const warnings = (review.text.avisos as string[]).filter(
        (w) => !w.includes('oficial') && !w.includes('Hoja oficial') && !w.includes('La imagen está quieta')
      )
      const expected = { clean: '', overflow: 'se sale', overlap: 'queda tapado', gap: 'cuadro casi vacío', narrow: 'espacio vacío' }[kind]
      if (kind === 'clean' ? warnings.length !== 0 : !warnings.some((w) => w.includes(expected)))
        throw Error(`Avisos incorrectos ${kind}: ${JSON.stringify(warnings)}`)
      if (!(review.text.movimiento as { aviso?: string })?.aviso)
        throw Error('Falta aviso de movimiento en la composición estática de prueba')
      quality[kind] = review
    }
    await mkdir(join(folder, 'wrong-format'))
    await writeFile(
      join(folder, 'wrong-format/index.html'),
      qualityComposition('clean').replace(/1080/g, '__W__').replace(/1920/g, '1080').replace(/__W__/g, '1920')
    )
    quality.wrongFormat = await call(
      'cuadros',
      { composicion: 'wrong-format/index.html', formato: 'vertical', segundos: [1] },
      '1920×1080, pero pediste vertical (1080×1920)'
    )
    await mkdir(join(folder, 'missing-composition'))
    await writeFile(join(folder, 'missing-composition/index.html'), '<html><body>Falta el contrato</body></html>')
    quality.missingComposition = await call(
      'cuadros',
      { composicion: 'missing-composition/index.html', formato: 'vertical', segundos: [1] },
      'no tiene un elemento con data-composition-id'
    )
    report.quality = quality
    report.cuadros = await call('cuadros', { composicion: 'promo/index.html', formato: 'vertical', segundos: [2.5, 7.5, 12.5] })
    if ((report.cuadros as { text: { revision?: { fuentesLocales: number } } }).text.revision?.fuentesLocales !== 18)
      throw Error('No se comprobaron las 18 familias locales')
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
    report.renderRepetido = await call('render', {
      composicion: 'promo/index.html',
      formato: 'vertical',
      duracion: 15,
      fps: 30,
      nombre: 'v32-render-15-vertical'
    })
    const videoPath = (r: unknown) => (r as { text: { ruta: string } }).text.ruta
    if (videoPath(report.render) !== videoPath(report.renderRepetido)) throw Error('El mismo nombre creó otro MP4')
    report.renderOtroNombre = await call('render', {
      composicion: 'promo/index.html',
      formato: 'vertical',
      duracion: 15,
      fps: 30,
      nombre: 'v32-mas-alegre'
    })
    if (videoPath(report.render) !== videoPath(report.renderOtroNombre)) throw Error('Cambiar nombre creó otro MP4')
    report.renderAparte = await call('render', {
      composicion: 'promo/index.html',
      formato: 'vertical',
      duracion: 15,
      fps: 30,
      nombre: 'v32-aparte',
      nueva_version: true
    })
    if (videoPath(report.render) === videoPath(report.renderAparte)) throw Error('No se creó la versión aparte')
    // Tramo quieto de 3 s en medio y tarjeta sin texto durante una transición de 0,6 s.
    for (const kind of ['quieto3', 'tarjeta-vacia'] as const) {
      await mkdir(join(folder, kind))
      const extra =
        kind === 'quieto3'
          ? "tl.fromTo('#moving',{x:0},{x:400,duration:3,ease:'none'},0);tl.to('#moving',{x:0,duration:3,ease:'none'},6);"
          : "tl.set('p',{opacity:0},4);tl.set('p',{opacity:1},4.6);"
      const html = qualityComposition('clean')
        .replace('<section ', '<section class="clip" data-start="0" data-duration="9" ')
        .replace('</section>', '<span data-beat data-start="4" data-duration="0.6"></span></section>')
        .replace(
          '</div><script',
          kind === 'quieto3'
            ? '<div id="moving" style="position:absolute;left:100px;top:600px;width:360px;height:700px;background:#fff"></div></div><script'
            : '</div><script'
        )
        .replace('window.__timelines=', `${extra}window.__timelines=`)
      await writeFile(join(folder, kind, 'index.html'), html)
      const checked = await call('render', { composicion: `${kind}/index.html`, formato: 'vertical', duracion: 9, fps: 30, nombre: kind })
      const avisos = checked.text.avisos as string[]
      if (
        kind === 'quieto3'
          ? !(checked.text.movimiento as { aviso?: string; tramos: { inicio: number; fin: number }[] }).aviso ||
            !(checked.text.movimiento as { tramos: { inicio: number; fin: number }[] }).tramos.some(
              (s) => s.inicio >= 2.75 && s.inicio <= 3.25 && s.fin >= 6 && s.fin <= 6.25
            )
          : !avisos.some((s) => s.includes('tarjeta sin contenido'))
      )
        throw Error(`Falta aviso en ${kind}`)
      report[kind] = checked
      const evidence = arg('--evidence-dir')
      if (evidence) {
        await mkdir(evidence, { recursive: true })
        await cp(videoPath(checked), join(evidence, `${kind}.mp4`))
        for (const [i, frame] of (checked.text.cuadros as string[]).entries()) await cp(frame, join(evidence, `${kind}-${i + 1}.png`))
      }
      if (kind === 'quieto3') {
        await writeFile(
          join(folder, kind, 'index.html'),
          html.replace(extra, "tl.fromTo('#moving',{x:0},{x:400,duration:9,ease:'none'},0);")
        )
        const revised = await call('cuadros', { composicion: `${kind}/index.html`, formato: 'vertical', segundos: [1, 4.5, 8] })
        if ((revised.text.movimiento as { aviso?: string }).aviso) throw Error('La revisión continua reutilizó una medida quieta')
        report.movimientoRecalculado = revised
      }
    }
    // Foto local: misma copia declarativa que en Chat/Code/Tareas, sin red ni atribución automática.
    const mediaDir = join(folder, 'media')
    await mkdir(mediaDir)
    await writeFile(
      join(mediaDir, 'index.html'),
      qualityComposition('clean').replace(
        '</body>',
        '<img src="assets/foto.png" style="position:absolute;left:100px;top:300px;width:300px;height:300px"></body>'
      )
    )
    await new Promise<void>((done, reject) => {
      const child = spawn(
        ready.paths.ffmpeg,
        ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=blue:s=320x320', '-frames:v', '1', '-threads', '1', join(folder, 'foto.png')],
        { stdio: 'ignore' }
      )
      child.once('error', reject)
      child.once('close', (code) => (code === 0 ? done() : reject(Error('foto fixture failed'))))
    })
    report.fotoRender = await call('render', {
      composicion: 'media/index.html',
      formato: 'vertical',
      duracion: 9,
      fps: 30,
      nombre: 'Con foto',
      fotos: [{ origen: 'foto.png', destino: 'assets/foto.png' }]
    })
    await new Promise<void>((done, reject) => {
      const child = spawn(
        ready.paths.ffmpeg,
        ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=10', join(folder, 'tono.wav')],
        { stdio: 'ignore' }
      )
      child.once('error', reject)
      child.once('close', (code) => (code === 0 ? done() : reject(Error('tone fixture failed'))))
    })
    report.audioRender = await call('render', {
      composicion: 'media/index.html',
      formato: 'vertical',
      duracion: 9,
      fps: 30,
      nombre: 'Con audio',
      audio: [{ origen: 'tono.wav', inicio: 1, desde: 2, hasta: 8, volumen: 0.4, fundidoEntrada: 0.2, fundidoSalida: 0.5 }]
    })
    if ((report.audioRender as { text: { audio?: { codec: string; duration: number } } }).text.audio?.codec !== 'aac')
      throw Error('No AAC track')
    await cp(join(folder, 'tono.wav'), join(mediaDir, 'tono.wav'))
    await writeFile(
      join(mediaDir, 'index.html'),
      qualityComposition('clean').replace(
        '<script>',
        '<audio id="tono" src="tono.wav" data-start="0.5" data-duration="5" data-volume="0.3" data-fade-in="0.2" data-fade-out="0.3"></audio><script>'
      )
    )
    report.audioTagRender = await call('render', {
      composicion: 'media/index.html',
      formato: 'vertical',
      duracion: 9,
      fps: 30,
      nombre: 'Audio HTML'
    })
    if ((report.audioTagRender as { text: { audio?: { codec: string } } }).text.audio?.codec !== 'aac') throw Error('No AAC from audio tag')
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
    await rm(work, { recursive: true, force: true })
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
