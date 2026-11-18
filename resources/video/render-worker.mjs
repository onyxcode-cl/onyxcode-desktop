/** Trusted adapter for the pinned HyperFrames timeline engine. No CLI, project config, plugins or network downloads. */
import childProcess from 'node:child_process'
import { createRequire } from 'node:module'
import { createServer } from 'node:http'
import { readFile, writeFile, lstat } from 'node:fs/promises'
import { join, resolve, sep, extname } from 'node:path'
import { pathToFileURL } from 'node:url'
import { randomBytes } from 'node:crypto'
import { once } from 'node:events'

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

async function run(file, args) {
  const child = childProcess.spawn(file, args, { stdio: ['ignore', 'pipe', 'pipe'] })
  let text = '', error = ''
  child.stdout.on('data', (b) => { text += b; if (text.length > 65536) child.kill('SIGKILL') })
  child.stderr.on('data', (b) => { error = (error + b).slice(-4096) })
  const code = await new Promise((done, reject) => { child.once('error', reject); child.once('close', done) })
  if (code !== 0) throw Error(error || 'Video process failed')
  return text
}
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.gif': 'image/gif', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.mp4': 'video/mp4', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.m4a': 'audio/mp4', '.webm': 'video/webm' }
async function main() {
  const modules = join(paths.hyperframes, 'node_modules')
  const require = createRequire(join(paths.hyperframes, 'package.json'))
  const puppeteer = (await import(pathToFileURL(require.resolve('puppeteer-core')).href)).default
  // These exports belong to HyperFrames 0.9.64 (the installer verifies the pinned package/lock).
  const { seekCompositionTimeline } = await import(pathToFileURL(join(modules, 'hyperframes/dist/chunk-ASML5H5V.js')).href)
  const secret = randomBytes(24).toString('hex')
  const prefix = `/${secret}/`
  const inputRoot = resolve(work, 'input')
  let origin
  server = createServer(async (req, res) => {
    try {
      if (req.headers.host !== new URL(origin).host || !['GET', 'HEAD'].includes(req.method) || !req.url.startsWith(prefix)) { res.writeHead(404).end(); return }
      const url = new URL(req.url, origin)
      const rel = decodeURIComponent(url.pathname.slice(prefix.length))
      if (rel.includes('\\') || rel.includes('\0')) throw Error('path')
      let file = resolve(inputRoot, rel)
      if (!file.startsWith(inputRoot + sep)) throw Error('path')
      // The only library exposed is the installed GSAP. Nothing else in node_modules is served.
      if (rel === 'node_modules/gsap/dist/gsap.min.js' || rel === 'composition/node_modules/gsap/dist/gsap.min.js') file = join(modules, 'gsap/dist/gsap.min.js')
      const st = await lstat(file)
      if (!st.isFile() || st.isSymbolicLink() || st.size > 32 * 1024 * 1024) throw Error('file')
      const data = await readFile(file)
      res.setHeader('Content-Type', mime[extname(file)] ?? 'application/octet-stream')
      res.setHeader('X-Content-Type-Options', 'nosniff')
      res.setHeader('Cache-Control', 'no-store')
      res.setHeader('Content-Security-Policy', `default-src 'none'; script-src ${origin} 'unsafe-inline'; style-src ${origin} 'unsafe-inline'; img-src ${origin} data:; font-src ${origin} data:; media-src ${origin} data:; connect-src ${origin}; frame-src 'none'; worker-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; sandbox allow-scripts allow-same-origin`)
      res.end(req.method === 'HEAD' ? undefined : data)
    } catch { if (!res.headersSent) res.writeHead(404); res.end() }
  })
  await new Promise((done, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', done) })
  origin = `http://127.0.0.1:${server.address().port}`
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
  await page.setBypassServiceWorker(true)
  await page.setRequestInterception(true)
  page.on('request', (req) => {
    const u = new URL(req.url())
    const allowed = u.origin === origin && u.pathname.startsWith(prefix) && ['GET', 'HEAD'].includes(req.method())
    void (allowed ? req.continue() : req.abort('blockedbyclient')).catch(() => {})
  })
  browser.on('targetcreated', (target) => { if (target.type() === 'page') void target.page().then((p) => p?.close()).catch(() => {}) })
  page.on('dialog', (dialog) => void dialog.dismiss())
  await page.evaluateOnNewDocument('self.__name = self.__name || ((fn) => fn)')
  await page.evaluateOnNewDocument(await readFile(join(modules, 'hyperframes/dist/hyperframe.runtime.iife.js'), 'utf8'))
  // A nesting level preserves the common ../node_modules/gsap URL while all project files remain at the same relative location.
  await page.goto(`${origin}${prefix}composition/index.html`, { waitUntil: 'load', timeout: 15000 })
  await page.evaluate(async () => { await document.fonts.ready; await Promise.all(Array.from(document.images, (img) => img.decode().catch(() => {}))) })
  await page.waitForFunction(() => window.__renderReady === true || typeof window.__hfStartupError === 'string', { timeout: 15000 })
  const startupError = await page.evaluate(() => window.__hfStartupError)
  if (startupError) throw Error('HyperFrames composition did not initialize')
  const metadata = await page.evaluate(() => {
    const el = document.querySelector('[data-composition-id]')
    return { width: Number(el?.getAttribute('data-width')), height: Number(el?.getAttribute('data-height')), duration: Number(el?.getAttribute('data-duration')), timeline: !!(window.__player || window.__hf || window.__timelines) }
  })
  if (!metadata.timeline || metadata.width !== width || metadata.height !== height || !Number.isFinite(metadata.duration) || metadata.duration <= 0 || metadata.duration > 120) throw Error('Composition metadata/timeline does not match format (maximum 120 s)')
  if (job.seconds !== undefined && Math.abs(metadata.duration - job.seconds) > 1 / 30) throw Error('Composition duration does not match requested duration')
  if (job.times.some((t) => t >= metadata.duration)) throw Error('Snapshot time outside composition')
  const seek = (time) => seekCompositionTimeline(page, time, { fallbackToBridgeAndTimelines: true, exactTime: true, animationFrameSettle: 'none', waitForFontsMs: 0 })
  const images = []
  await page.setViewport({ width, height, deviceScaleFactor: 0.25 })
  for (let i = 0; i < job.times.length; i++) {
    await seek(job.times[i])
    const file = join(work, `control-${i + 1}.png`)
    await page.screenshot({ path: file, type: 'png' })
    images.push(file)
  }
  let duration, mp4
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
    const info = JSON.parse(await run(paths.ffprobe, ['-v', 'error', '-show_entries', 'format=duration:stream=codec_name,width,height,r_frame_rate', '-of', 'json', mp4]))
    duration = Number(info.format.duration)
    const stream = info.streams[0]
    // Control images come from the encoded MP4, including its final colors and compression.
    for (let i = 0; i < job.times.length; i++) await run(paths.ffmpeg, ['-v', 'error', '-y', '-ss', String(job.times[i]), '-i', mp4, '-frames:v', '1', '-vf', 'scale=iw/4:ih/4', '-threads', '1', images[i]])
    if (!Number.isFinite(duration) || Math.abs(duration - job.seconds) > 1 / 30 || stream.codec_name !== 'h264' || stream.width !== width || stream.height !== height || stream.r_frame_rate !== '30/1') throw Error('MP4 verification failed')
  }
  // Only fixed fields and filenames leave this process, never composition-controlled output.
  return { duration, mp4, images, ownedPids }
}
try {
  const output = await main()
  await cleanup()
  process.stdin.pause()
  process.stdout.write(JSON.stringify(output))
} catch (error) {
  console.error(error.stack ?? error)
  await cleanup()
  process.exitCode = 1
  process.stdin.pause()
}
