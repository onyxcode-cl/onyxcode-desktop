/** Trusted adapter for the pinned HyperFrames timeline engine. No CLI, project config, plugins or network downloads. */
import childProcess from 'node:child_process'
import { createRequire } from 'node:module'
import { createServer } from 'node:http'
import { readFile, writeFile, lstat, rename, readdir } from 'node:fs/promises'
import { join, resolve, sep, extname } from 'node:path'
import { pathToFileURL } from 'node:url'
import { randomBytes } from 'node:crypto'
import { FONT_NAMES, embeddedFonts, groupWarnings, audioFilter } from './offline-tools.mjs'
import { once } from 'node:events'
import { inspectFrame, colorVariation, needsSmallerFrames } from './inspect-frame.mjs'

const job = JSON.parse(process.argv[2])
const { work, paths, width, height } = job
const children = new Set()
const ownedPids = []
const originalSpawn = childProcess.spawn.bind(childProcess)
// Puppeteer otherwise detaches Chrome into a separate process group. All descendants belong to MAIN's render group.
childProcess.spawn = (file, args, options = {}) => {
  if (![paths.chrome, paths.ffmpeg, paths.ffprobe].includes(file)) throw Error('Unexpected render executable')
  const child = originalSpawn(file, args, { ...options, detached: false, windowsHide: true })
  children.add(child)
  if (child.pid) ownedPids.push(child.pid)
  child.once('close', () => children.delete(child))
  return child
}
let browser, server
const cleanup = async () => {
  await browser?.close().catch(() => {})
  for (const child of children) { try { child.kill('SIGKILL') } catch {} }
  server?.closeAllConnections()
  await new Promise((done) => server ? server.close(done) : done())
}
let closing = false
const stop = () => {
  if (closing) return
  closing = true
  // Main disappearing must also end the render. On POSIX kill this worker's OWN group.
  if (process.platform !== 'win32') { try { process.kill(-process.pid, 'SIGKILL') } catch {} }
  if (process.platform === 'win32') {
    originalSpawn(join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'taskkill.exe'), ['/PID', String(process.pid), '/T', '/F'], { windowsHide: true })
  }
  void cleanup().finally(() => process.exit(1))
}
process.stdin.resume()
process.stdin.on('end', stop)
process.on('SIGTERM', stop)
process.on('SIGINT', stop)

class RenderFailure extends Error {
  constructor(code, data = {}) { super(code); this.code = code; this.data = data }
}
async function run(file, args, raw = false) {
  const child = childProcess.spawn(file, args, { stdio: ['ignore', 'pipe', 'pipe'] })
  const chunks = []; let size = 0, error = ''
  child.stdout.on('data', (b) => { size += b.length; if (size > 65536) child.kill('SIGKILL'); else chunks.push(b) })
  child.stderr.on('data', (b) => { error = (error + b).slice(-4096) })
  const code = await new Promise((done, reject) => { child.once('error', reject); child.once('close', done) })
  if (code !== 0) throw Error(error || 'Video process failed')
  const bytes = Buffer.concat(chunks)
  return raw ? bytes : bytes.toString('utf8')
}
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.gif': 'image/gif', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.mp4': 'video/mp4', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.m4a': 'audio/mp4', '.webm': 'video/webm' }
async function main() {
  const modules = join(paths.hyperframes, 'node_modules')
  const require = createRequire(join(paths.hyperframes, 'package.json'))
  const puppeteer = (await import(pathToFileURL(require.resolve('puppeteer-core')).href)).default
  // These exports belong to HyperFrames 0.9.64 (the installer verifies the pinned package/lock).
  const { seekCompositionTimeline } = await import(pathToFileURL(join(modules, 'hyperframes/dist/chunk-ASML5H5V.js')).href)
  const dist = join(modules, 'hyperframes/dist')
  const { EMBEDDED_FONT_DATA } = await import(pathToFileURL(join(dist, 'chunk-FI4I7CME.js')).href)
  const secret = randomBytes(24).toString('hex')
  const prefix = `/${secret}/`
  const inputRoot = resolve(work, 'input')
  let origin, fonts
  server = createServer(async (req, res) => {
    try {
      if (req.headers.host !== new URL(origin).host || !['GET', 'HEAD'].includes(req.method) || !req.url.startsWith(prefix)) { res.writeHead(404).end(); return }
      const url = new URL(req.url, origin)
      const rel = decodeURIComponent(url.pathname.slice(prefix.length))
      if (rel.includes('\\') || rel.includes('\0')) throw Error('path')
      let file = resolve(inputRoot, rel)
      if (!file.startsWith(inputRoot + sep)) throw Error('path')
      // The only library exposed is the installed GSAP. Nothing else in node_modules is served.
      if (rel === 'node_modules/gsap/dist/gsap.min.js' || rel === 'composition/node_modules/gsap/dist/gsap.min.js' || rel === 'composition/assets/vendor/gsap.min.js') file = join(modules, 'gsap/dist/gsap.min.js')
      const font = rel.startsWith('_lzx/fonts/') ? fonts.files.get(rel.slice('_lzx/fonts/'.length)) : undefined
      const st = font ? { isFile: () => true, isSymbolicLink: () => false, size: font.length } : await lstat(file)
      if (!st.isFile() || st.isSymbolicLink() || st.size > (/\.(mp3|m4a|wav|aac|ogg)$/i.test(file) ? 50 : 32) * 1024 * 1024) throw Error('file')
      let data = font ?? await readFile(file)
      // Solo añade las fuentes fijadas al documento raíz; el runtime monta escenas en el mismo DOM.
      if (rel === 'composition/index.html') {
        const html = data.toString('utf8'), style = `<style>${fonts.css}</style>`
        data = Buffer.from(/<head(?:\s[^>]*)?>/i.test(html) ? html.replace(/<head(?:\s[^>]*)?>/i, (tag) => tag + style) : style + html)
      }
      res.setHeader('Content-Type', (font ? 'font/woff2' : mime[extname(file)]) ?? 'application/octet-stream')
      res.setHeader('X-Content-Type-Options', 'nosniff')
      res.setHeader('Cache-Control', 'no-store')
      res.setHeader('Content-Security-Policy', `default-src 'none'; script-src ${origin} 'unsafe-inline'; style-src ${origin} 'unsafe-inline'; img-src ${origin} data:; font-src ${origin} data:; media-src ${origin} data:; connect-src ${origin}; frame-src 'none'; worker-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; sandbox allow-scripts allow-same-origin`)
      res.end(req.method === 'HEAD' ? undefined : data)
    } catch { if (!res.headersSent) res.writeHead(404); res.end() }
  })
  await new Promise((done, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', done) })
  origin = `http://127.0.0.1:${server.address().port}`
  fonts = embeddedFonts(EMBEDDED_FONT_DATA, `${origin}${prefix}_lzx/fonts/`)
  const args = [
    '--disable-background-networking', '--disable-component-update', '--disable-sync', '--no-first-run',
    '--disable-quic', '--disable-extensions', '--disable-breakpad', '--disable-crash-reporter',
    '--force-webrtc-ip-handling-policy=disable_non_proxied_udp',
    '--proxy-server=http://127.0.0.1:9', `--proxy-bypass-list=<-loopback>;127.0.0.1:${server.address().port}`,
    '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1'
  ]
  // Seatbelt supplies the OS boundary on macOS. One process avoids LaunchServices/mach services outside that boundary.
  if (process.platform === 'darwin') args.push('--single-process', '--no-sandbox', '--disable-gpu-compositing')
  browser = await puppeteer.launch({ executablePath: paths.chrome, headless: true, pipe: true, userDataDir: join(work, 'profile'), args, defaultViewport: { width, height }, protocolTimeout: 30000, timeout: 30000 })
  const page = await browser.newPage()
  let firstConsoleError = ''
  const recordError = (text) => { if (!firstConsoleError) firstConsoleError = String(text).replace(/[\x00-\x1f\x7f]/g, ' ').slice(0, 240) }
  page.on('pageerror', (error) => recordError(error.message))
  page.on('console', (message) => { if (message.type() === 'error') recordError(message.text()) })
  await page.setBypassServiceWorker(true)
  await page.setRequestInterception(true)
  page.on('request', (req) => {
    const u = new URL(req.url())
    const allowed = (u.protocol === 'data:' && ['image', 'font', 'media'].includes(req.resourceType())) || (u.origin === origin && u.pathname.startsWith(prefix) && ['GET', 'HEAD'].includes(req.method()))
    void (allowed ? req.continue() : req.abort('blockedbyclient')).catch(() => {})
  })
  browser.on('targetcreated', (target) => { if (target.type() === 'page') void target.page().then((p) => p?.close()).catch(() => {}) })
  page.on('dialog', (dialog) => void dialog.dismiss())
  await page.evaluateOnNewDocument('self.__name = self.__name || ((fn) => fn); window.__timelines = {};')
  await page.evaluateOnNewDocument(await readFile(join(modules, 'hyperframes/dist/hyperframe.runtime.iife.js'), 'utf8'))
  // A nesting level preserves the common ../node_modules/gsap URL while all project files remain at the same relative location.
  await page.goto(`${origin}${prefix}composition/index.html`, { waitUntil: 'load', timeout: 15000 })
  await page.addStyleTag({ content: fonts.css })
  // Check the author's contract before waiting on runtime readiness: missing markup is not a sandbox failure.
  const metadata = await page.evaluate(() => {
    const el = document.querySelector('[data-composition-id]')
    const tl = window.__timelines?.main
    return { composition: !!el, width: Number(el?.getAttribute('data-width')), height: Number(el?.getAttribute('data-height')), duration: Number(el?.getAttribute('data-duration')), timeline: !!tl && typeof tl.seek === 'function' && typeof tl.paused === 'function' && tl.paused() }
  })
  if (!metadata.composition) throw new RenderFailure('falta_composicion')
  if (metadata.width !== width || metadata.height !== height) throw new RenderFailure('formato_no_coincide', { width: metadata.width, height: metadata.height })
  if (!Number.isFinite(metadata.duration) || metadata.duration <= 0 || metadata.duration > 120) throw new RenderFailure('duracion_invalida')
  if (job.seconds !== undefined && Math.abs(metadata.duration - job.seconds) > 1 / 30) throw new RenderFailure('duracion_no_coincide', { duration: metadata.duration })
  if (job.times.some((t) => t >= metadata.duration)) throw new RenderFailure('tiempo_fuera', { time: job.times.find((t) => t >= metadata.duration), duration: metadata.duration })
  if (!metadata.timeline) throw new RenderFailure(firstConsoleError ? 'no_inicializa' : 'falta_timeline', { console: firstConsoleError })
  try {
    await page.waitForFunction(() => window.__renderReady === true || typeof window.__hfStartupError === 'string', { timeout: 15000 })
  } catch { throw new RenderFailure('no_inicializa', { console: firstConsoleError }) }
  const startupError = await page.evaluate(() => window.__hfStartupError)
  if (startupError) throw new RenderFailure('no_inicializa', { console: firstConsoleError || String(startupError).slice(0, 240) })
  await page.evaluate(async () => { await document.fonts.ready; await Promise.all(Array.from(document.images, (img) => img.decode().catch(() => {}))) })
  const fontProof = await page.evaluate(async (families) => Promise.all(families.map(async (name) => {
    const faces = await document.fonts.load(`400 32px "${name}"`, 'Aa ñ')
    return faces.length > 0 && faces.every((face) => face.status === 'loaded')
  })), FONT_NAMES)
  if (!fontProof.every(Boolean)) throw Error('No se cargaron las fuentes incluidas sin conexión.')
  const seek = (time) => seekCompositionTimeline(page, time, { fallbackToBridgeAndTimelines: true, exactTime: true, animationFrameSettle: 'none', waitForFontsMs: 0 })
  const images = []
  await page.setViewport({ width, height, deviceScaleFactor: 0.5 })
  const findings = [], cobertura = []
  let oficial = false, hojaOficial = false
  let audit
  try {
    const { createPageDriver } = await import(pathToFileURL(join(dist, 'chunk-2PIQTMWA.js')).href)
    audit = createPageDriver(page)
    await audit.initialize(false)
    oficial = true
  } catch {
    findings.push({ message: 'No se pudo cargar el auditor oficial; se conserva la revisión propia.' })
  }
  // Lint puro por HTML: el lintProject completo sigue src del autor en Node (no seguro en Windows).
  try {
    const { lintHyperframeHtml } = await import(pathToFileURL(join(dist, 'chunk-NDXUDTLF.js')).href)
    const walkHtml = async (dir) => {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        const file = join(dir, entry.name)
        if (entry.isDirectory()) await walkHtml(file)
        else if (entry.name.endsWith('.html')) {
          const rel = file.slice(join(inputRoot, 'composition').length + 1)
          const lint = await lintHyperframeHtml(await readFile(file, 'utf8'), { isSubComposition: rel !== 'index.html' })
          for (const issue of (lint.findings ?? []).slice(0, 40)) findings.push({ code: issue.rule ?? issue.code, selector: rel, message: `Revisión oficial (${issue.rule ?? issue.code}): ${issue.message}` })
        }
      }
    }
    await walkHtml(join(inputRoot, 'composition'))
  } catch { findings.push({ message: 'No se pudo completar el lint oficial sin conexión.' }) }
  const sheetFrames = []
  const sceneTimes = await page.evaluate(() => [...document.querySelectorAll('[data-composition-src], [data-beat]')].flatMap((el) => {
    const start = Number(el.getAttribute('data-start') || 0), duration = Number(el.getAttribute('data-duration') || 0)
    return [start - 0.2, start + 0.2, start + duration / 2]
  }).filter((t) => Number.isFinite(t) && t >= 0))
  const candidates = [...new Set([...job.times, ...sceneTimes.filter((t) => t < metadata.duration), ...Array.from({ length: 8 }, (_, i) => metadata.duration * (i + 1) / 9)])].sort((a, b) => a - b)
  const checkTimes = candidates.length <= 24 ? candidates : [...new Set([...job.times, ...Array.from({ length: 18 }, (_, i) => candidates[Math.round(i * (candidates.length - 1) / 17)])])].sort((a, b) => a - b)
  for (const time of checkTimes) {
    await seek(time)
    const review = await page.evaluate(inspectFrame, { width, height })
    for (const issue of review.details) findings.push({ time, ...issue })
    if (audit) {
      for (const issue of [...await audit.collectLayout(time, 2), ...await audit.collectOverlap(time)].slice(0, 40)) {
        findings.push({ time, code: issue.code, selector: issue.selector, message: `Revisión oficial (${issue.code}): ${issue.message}` })
      }
    }
    if (job.seconds === undefined && sheetFrames.length < 24) {
      const file = join(work, `at-${Number(time.toFixed(2))}s.png`)
      await page.screenshot({ path: file, type: 'png' })
      sheetFrames.push(file)
    }
    cobertura.push({ segundo: time, proporcion: review.coverage })
    if (!review.visibleText) {
      const file = join(work, 'inspect.png')
      await page.screenshot({ path: file, type: 'png' })
      const rgb = await run(paths.ffmpeg, ['-v', 'error', '-i', file, '-vf', 'scale=16:16', '-frames:v', '1', '-pix_fmt', 'rgb24', '-f', 'rawvideo', '-threads', '1', 'pipe:1'], true)
      if (colorVariation(rgb) < 8) findings.push({ time, message: 'cuadro casi vacío: sin texto visible y con poca variación de color' })
    }
  }
  let contactSheet
  if (sheetFrames.length) {
    contactSheet = join(work, 'contactos.png')
    try {
      const { createContactSheet } = await import(pathToFileURL(join(dist, 'contactSheet-JFEV75W2.js')).href)
      const sheet = await createContactSheet(sheetFrames, join(work, 'sheet.jpg'), { cols: 4, maxImages: 24, cellWidth: 200, labelMode: 'custom', labels: sheetFrames.map((p) => p.match(/at-([\d.]+)s/)[1] + ' s') })
      if (!sheet) throw Error('No contact sheet')
      await run(paths.ffmpeg, ['-v', 'error', '-y', '-i', sheet, '-frames:v', '1', '-threads', '1', contactSheet])
      hojaOficial = true
    } catch {
      // Sharp es opcional en el paquete: jamás se instala desde un render.
      findings.push({ message: 'Hoja oficial no disponible sin su dependencia opcional; hoja propia con los mismos tiempos.' })
      await page.setViewport({ width: 816, height: Math.ceil(sheetFrames.length / 4) * (Math.round(200 * height / width) + 28), deviceScaleFactor: 1 })
      const cells = []
      for (const file of sheetFrames) cells.push({ src: (await readFile(file)).toString('base64'), label: file.match(/at-([\d.]+)s/)[1] })
      // Nueva página con la misma CSP/intercepción: solo imágenes data creadas por el worker.
      await page.evaluate(({ cells, h }) => {
        document.body.replaceChildren()
        document.documentElement.style.cssText = 'margin:0;background:#181818;overflow:hidden'
        document.body.style.cssText = 'margin:0;padding:4px;display:grid;grid-template-columns:repeat(4,200px);gap:4px;color:white;font:14px sans-serif'
        for (const cell of cells) {
          const box = document.createElement('div'), label = document.createElement('div'), img = document.createElement('img')
          label.textContent = cell.label + ' s'; label.style.height = '24px'
          img.src = 'data:image/png;base64,' + cell.src; img.style.cssText = `width:200px;height:${h}px;display:block`
          box.append(label, img); document.body.append(box)
        }
      }, { cells, h: Math.round(200 * height / width) })
      await page.evaluate(async () => { await Promise.all([...document.images].map((img) => img.decode())) })
      await page.screenshot({ path: contactSheet, type: 'png' })
      // Recupera la composición sin perder su contrato ni los recursos locales.
      await page.setViewport({ width, height, deviceScaleFactor: 0.5 })
      await page.goto(`${origin}${prefix}composition/index.html`, { waitUntil: 'load', timeout: 15000 })
      await page.waitForFunction(() => window.__renderReady === true, { timeout: 15000 })
      await page.addStyleTag({ content: fonts.css })
      await page.evaluate(async () => { await document.fonts.ready })
    }
    while ((await lstat(contactSheet)).size > 1024 * 1024) {
      const small = join(work, 'sheet-small.png')
      await run(paths.ffmpeg, ['-v', 'error', '-y', '-i', contactSheet, '-vf', 'scale=iw/2:ih/2', '-threads', '1', small])
      await rename(small, contactSheet)
    }
  }
  for (let i = 0; i < job.times.length; i++) {
    await seek(job.times[i])
    const file = join(work, `control-${i + 1}.png`)
    await page.screenshot({ path: file, type: 'png' })
    images.push(file)
  }
  let duration, mp4, audioInfo
  if (job.seconds !== undefined) {
    await page.setViewport({ width, height, deviceScaleFactor: 1 })
    mp4 = join(work, 'video.mp4')
    const encoder = childProcess.spawn(paths.ffmpeg, ['-v', 'error', '-y', '-f', 'image2pipe', '-vcodec', 'mjpeg', '-r', '30', '-i', 'pipe:0', '-an', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-threads', '4', '-fs', '268435456', mp4], { stdio: ['pipe', 'ignore', 'pipe'] })
    let encoderError = ''
    encoder.stderr.on('data', (b) => { encoderError = (encoderError + b).slice(-4096) })
    encoder.stdin.on('error', () => {})
    const finished = new Promise((done, reject) => { encoder.once('error', reject); encoder.once('close', (code) => code === 0 ? done() : reject(Error(encoderError || 'Encoder failed'))) })
    // Observe rejection immediately, including while screenshots are being captured.
    void finished.catch(() => {})
    for (let frame = 0; frame < Math.round(job.seconds * 30); frame++) {
      await seek(frame / 30)
      const bytes = await page.screenshot({ type: 'jpeg', quality: 95, optimizeForSpeed: true })
      if (encoder.exitCode !== null || encoder.signalCode !== null) throw Error('Encoder stopped')
      if (!encoder.stdin.write(bytes)) await Promise.race([once(encoder.stdin, 'drain'), finished.then(() => { throw Error('Encoder stopped') })])
    }
    encoder.stdin.end()
    await finished
    // Audio declarativo: ningún src remoto ni playlist llega a ffmpeg.
    const declaredAudio = await page.evaluate(() => [...document.querySelectorAll('audio')].slice(0, 17).map((el) => {
      let offset = 0, end = Infinity
      const parents = []
      for (let p = el.parentElement; p; p = p.parentElement) if (p.hasAttribute('data-composition-src') || p.hasAttribute('data-composition-file')) parents.unshift(p)
      for (const p of parents) {
        const start = Number(p.getAttribute('data-start') || 0), d = Number(p.getAttribute('data-duration'))
        offset += start
        if (d > 0) end = Math.min(end, offset + d)
      }
      return { src: el.currentSrc || el.src || el.querySelector('source')?.src, inicio: offset + Number(el.getAttribute('data-start') || 0), desde: Number(el.getAttribute('data-media-start') || 0), slot: Number(el.getAttribute('data-duration')) || null, end: Number.isFinite(end) ? end : null, rate: Number(el.getAttribute('data-playback-rate') || 1), volumen: el.muted || el.hasAttribute('data-hidden') ? 0 : Number(el.getAttribute('data-volume') ?? 1), fundidoEntrada: Number(el.getAttribute('data-fade-in') || 0), fundidoSalida: Number(el.getAttribute('data-fade-out') || 0), automation: el.hasAttribute('data-automation') }
    }))
    if (declaredAudio.length > 16) throw new RenderFailure('audio_invalido', { console: 'Hasta 16 elementos audio por composición.' })
    const tracks = [...(job.audio ?? [])]
    for (const track of declaredAudio) {
      const url = new URL(track.src)
      if (url.origin !== origin || !url.pathname.startsWith(prefix + 'composition/')) throw new RenderFailure('audio_invalido', { console: 'El audio de la composición debe ser un archivo local.' })
      const file = resolve(inputRoot, decodeURIComponent(url.pathname.slice(prefix.length)))
      if (!file.startsWith(resolve(inputRoot, 'composition') + sep) || !/\.(mp3|m4a|wav|aac|ogg)$/i.test(file)) throw new RenderFailure('audio_invalido', { console: 'Audio local no admitido.' })
      if (track.automation) findings.push({ message: 'El audio usa data-automation: solo se aplican volumen y fundidos lineales.' })
      tracks.push({ ...track, file })
    }
    const mixed = []
    for (const t of tracks) {
      const rate = t.rate ?? 1
      if ([t.inicio, t.desde, t.volumen, t.fundidoEntrada, t.fundidoSalida, rate].some((v) => typeof v !== 'number' || !Number.isFinite(v) || v < 0) || rate < 0.1 || rate > 10 || t.volumen > 3.98 || t.desde > 86400 || t.fundidoEntrada > 120 || t.fundidoSalida > 120 || (t.slot !== undefined && t.slot !== null && (!Number.isFinite(t.slot) || t.slot < 0))) throw new RenderFailure('audio_invalido', { console: 'Tiempos o volumen de audio inválidos.' })
      const st = await lstat(t.file)
      if (!st.isFile() || st.isSymbolicLink() || st.size > 50 * 1024 * 1024) throw new RenderFailure('audio_invalido', { console: 'Archivo de audio inválido.' })
      const meta = JSON.parse(await run(paths.ffprobe, ['-v', 'error', '-protocol_whitelist', 'file,pipe', '-format_whitelist', 'mp3,wav,mov,aac,ogg', '-show_entries', 'format=duration:stream=codec_type', '-of', 'json', t.file]))
      const sourceDuration = Number(meta.format?.duration)
      if (!Number.isFinite(sourceDuration) || !meta.streams?.some((s) => s.codec_type === 'audio')) throw new RenderFailure('audio_invalido', { console: 'El archivo no contiene audio válido.' })
      if (t.desde >= sourceDuration) throw new RenderFailure('audio_invalido', { console: 'El recorte comienza después del audio.' })
      const sourceEnd = t.hasta ?? sourceDuration
      if (!Number.isFinite(sourceEnd) || sourceEnd <= t.desde || sourceEnd > sourceDuration + 0.1) throw new RenderFailure('audio_invalido', { console: 'El recorte termina fuera del audio.' })
      const clipDuration = Math.min(sourceEnd - t.desde, (job.seconds - t.inicio) * rate, (t.slot ?? 120) * rate, ((t.end ?? job.seconds) - t.inicio) * rate)
      if (clipDuration > 0 && t.volumen > 0) mixed.push({ ...t, rate, duration: clipDuration })
    }
    if (mixed.length) {
      const out = join(work, 'mixed.mp4')
      const inputs = mixed.flatMap((t) => ['-protocol_whitelist', 'file,pipe', '-format_whitelist', 'mp3,wav,mov,aac,ogg', '-i', t.file])
      await run(paths.ffmpeg, ['-v', 'error', '-y', '-i', mp4, ...inputs, '-filter_complex', audioFilter(mixed, job.seconds), '-map', '0:v:0', '-map', '[mix]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-t', String(job.seconds), '-movflags', '+faststart', '-threads', '4', '-fs', '268435456', out])
      await rename(out, mp4)
    }
    const info = JSON.parse(await run(paths.ffprobe, ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type,codec_name,width,height,r_frame_rate,duration', '-of', 'json', mp4]))
    const audioStream = info.streams.find((s) => s.codec_type === 'audio')
    if (mixed.length && (!audioStream || audioStream.codec_name !== 'aac' || Math.abs(Number(audioStream.duration) - job.seconds) > 0.05)) throw new RenderFailure('audio_invalido', { console: 'AAC verification failed' })
    if (audioStream) audioInfo = { codec: audioStream.codec_name, duration: Number(audioStream.duration) }
    duration = Number(info.format.duration)
    const stream = info.streams[0]
    // Control images come from the encoded MP4, including its final colors and compression.
    for (let i = 0; i < job.times.length; i++) await run(paths.ffmpeg, ['-v', 'error', '-y', '-ss', String(job.times[i]), '-i', mp4, '-frames:v', '1', '-vf', 'scale=iw/2:ih/2', '-threads', '1', images[i]])
    if (!Number.isFinite(duration) || Math.abs(duration - job.seconds) > 1 / 30 || stream.codec_name !== 'h264' || stream.width !== width || stream.height !== height || stream.r_frame_rate !== '30/1') throw Error('MP4 verification failed')
  }
  // Budget: at most 3 MiB of PNG (~4 MiB base64). Prefer half size; noisy compositions fall back to quarter.
  const sizes = await Promise.all(images.map(async (p) => (await lstat(p)).size))
  if (needsSmallerFrames(sizes)) {
    for (const file of images) {
      const resized = join(work, 'resized.png')
      await run(paths.ffmpeg, ['-v', 'error', '-y', '-i', file, '-vf', 'scale=iw/2:ih/2', '-threads', '1', resized])
      await rename(resized, file)
    }
  }
  // Filenames are fixed. Advisory page text is capped by inspectFrame; main never authorizes from these diagnostics.
  return { duration, mp4, images, contactSheet, ownedPids, avisos: groupWarnings(findings), cobertura, audio: audioInfo, revision: { oficial, hojaOficial, fuentesLocales: fontProof.filter(Boolean).length, alcance: 'Lint y muestreo oficial de geometría y superposiciones, más revisión propia. No ejecuta el pipeline completo de check (movimiento, contraste y craft).' } }
}
try {
  const output = await main()
  await cleanup()
  process.stdin.pause()
  process.stdout.write(JSON.stringify(output))
} catch (error) {
  console.error(error.stack ?? error)
  process.stdout.write(JSON.stringify({ error: { code: error instanceof RenderFailure ? error.code : error.name === 'TimeoutError' ? 'tiempo_agotado' : 'fallo_render', data: error instanceof RenderFailure ? error.data : {} } }))
  await cleanup()
  process.exitCode = 1
  process.stdin.pause()
}
