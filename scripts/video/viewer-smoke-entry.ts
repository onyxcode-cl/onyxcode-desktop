import { app, BrowserWindow } from 'electron'
import { realpathSync, mkdirSync, writeFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { Readable } from 'node:stream'
import { registerAppSchemePrivileges } from '../../src/main/security/app-protocol'
import { installViewerScheme, registerViewerPathValidator, VIEWER_CSP } from '../../src/main/viewer/scheme'
import { viewerSession } from '../../src/main/viewer/session'
import { issueToken } from '../../src/main/viewer/tokens'
import { videoPreview } from '../../src/main/video/preview'
async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const arg = (name: string): string => {
    const i = args.indexOf(name)
    if (i < 0 || !args[i + 1]) throw Error(`Falta ${name}`)
    return args[i + 1]
  }
  const file = realpathSync(arg('--mp4'))
  const evidence = resolve(arg('--evidence'))
  const temp = process.env.VIDEO_VIEWER_TEMP!
  const node = args.includes('--node')
  mkdirSync(evidence, { recursive: true })
  registerViewerPathValidator((path) => {
    if (realpathSync(path) !== file) throw Error('fuera')
    return file
  })
  const token = issueToken({ path: file, kind: 'mp4' })
  const report: Record<string, unknown> = {
    runtime: node
      ? args.includes('--no-browser')
        ? 'Node (sin navegador)'
        : 'Node + navegador (diagnóstico HTTP, sin sesión Electron)'
      : 'Electron',
    fileBytes: 0
  }
  const script = `(() => {
 const v = document.querySelector('video');
 if (!v) return null;
 return { duration: v.duration, currentTime: v.currentTime, paused: v.paused, muted: v.muted, controls: v.controls, readyState: v.readyState, width: v.videoWidth, height: v.videoHeight, error: v.error?.code ?? null };
})()`
  async function verify(evaluate: (s: string) => Promise<any>, screenshot: () => Promise<Buffer>): Promise<void> {
    const until = async (s: string): Promise<void> => {
      const deadline = Date.now() + 20000
      while (!(await evaluate(s))) {
        if (Date.now() > deadline) throw Error(`Visor sin respuesta: ${JSON.stringify(await evaluate(script))}`)
        await new Promise((r) => setTimeout(r, 100))
      }
    }
    await until("document.querySelector('video')?.readyState >= 2")
    report.initial = await evaluate(script)
    if (!(report.initial as any).paused || !(report.initial as any).muted || !(report.initial as any).controls)
      throw Error('Estado inicial incorrecto')
    await evaluate("document.querySelector('video').play().then(() => true)")
    await until("document.querySelector('video').currentTime > 0.2")
    report.playing = await evaluate(script)
    await evaluate("document.querySelector('video').pause(); document.querySelector('video').currentTime = 10; true")
    await until(
      "!document.querySelector('video').seeking && document.querySelector('video').currentTime >= 10 && document.querySelector('video').readyState >= 2"
    )
    report.seeked = await evaluate(script)
    writeFileSync(join(evidence, 'visor-mp4-10s.png'), await screenshot())
  }
  try {
    if (node && args.includes('--no-browser')) {
      installViewerScheme()
      const handler = (globalThis as any).__viewerHandler as (r: Request) => Promise<Response>
      const request = (range: string) => new Request(`lazunox-viewer://viewer/doc/${token}`, { headers: { Range: range } })
      const checks = []
      for (const range of ['bytes=0-31', 'bytes=524288-525311', 'bytes=999999999-', 'bytes=0-1,4-5']) {
        const response = await handler(request(range))
        checks.push({
          range,
          status: response.status,
          contentRange: response.headers.get('content-range'),
          bytes: (await response.arrayBuffer()).byteLength
        })
      }
      if (checks.map((c) => c.status).join(',') !== '206,206,416,416') throw Error('Rangos incorrectos')
      report.rangeChecks = checks
      registerViewerPathValidator(() => {
        throw Error('fuera')
      })
      report.limitation =
        'Solo Node: rangos reales y decodificación de miniatura; no comprueba reproducción, avance por controles ni captura de Electron.'
      report.preview = await videoPreview(
        file,
        (p) => {
          if (realpathSync(p) !== file) throw Error('fuera')
          return file
        },
        arg('--ffmpeg')
      ).then((p) => ({ duration: p?.duration, poster: !!p?.poster }))
      if (!(report.preview as any).poster || (report.preview as any).duration !== 15) throw Error('Miniatura o duración incorrecta')
      report.ok = true
      return
    }
    if (!node) {
      mkdirSync(join(temp, 'userData'), { recursive: true })
      mkdirSync(join(temp, 'sessionData'), { recursive: true })
      app.setPath('userData', join(temp, 'userData'))
      app.setPath('sessionData', join(temp, 'sessionData'))
      registerAppSchemePrivileges()
      await app.whenReady()
      installViewerScheme()
      const win = new BrowserWindow({
        width: 600,
        height: 960,
        show: true,
        webPreferences: { session: viewerSession(), sandbox: true, contextIsolation: true, nodeIntegration: false }
      })
      await win.loadURL(`lazunox-viewer://viewer/index.html#t=${token}&kind=mp4&lang=es&theme=dark`)
      await verify(
        (s) => win.webContents.executeJavaScript(s, true),
        async () => (await win.webContents.capturePage()).toPNG()
      )
      win.destroy()
    } else {
      // Mismo handler /doc y mismo bundle. Solo CSP del diagnóstico se adapta al origen HTTP efímero.
      installViewerScheme()
      const handler = (globalThis as any).__viewerHandler as (r: Request) => Promise<Response>
      const ranges: string[] = []
      const server = createServer(async (req, res) => {
        try {
          const url = new URL(req.url!, 'http://127.0.0.1')
          if (url.pathname === '/smoke-controls.js') {
            res.writeHead(200, { 'content-type': 'text/javascript' }).end(`
const report = (stage) => { const v = document.querySelector('video'); if (v) fetch('/_probe', {method:'POST', body:JSON.stringify({stage,duration:v.duration,currentTime:v.currentTime,paused:v.paused,muted:v.muted,controls:v.controls,readyState:v.readyState,width:v.videoWidth,height:v.videoHeight,error:v.error?.code??null})}); };
let jumped=false;
const timer=setInterval(()=>{const v=document.querySelector('video');if(!v)return;if(v.readyState>=2){report('initial');clearInterval(timer);v.addEventListener('timeupdate',()=>{if(!jumped&&v.currentTime>0.2){jumped=true;report('playing');v.pause();v.currentTime=10;}});v.addEventListener('seeked',()=>report('seeked'));}},100);
`)
            return
          }
          if (url.pathname === '/_probe' && req.method === 'POST') {
            let body = ''
            for await (const chunk of req) {
              body += chunk
              if (body.length > 4096) throw Error('probe')
            }
            const value = JSON.parse(body)
            report[value.stage] = value
            report.ranges = ranges
            writeFileSync(join(evidence, 'visor-informe.json'), JSON.stringify(report, null, 2))
            res.writeHead(204).end()
            return
          }
          if (url.pathname.startsWith('/doc/')) {
            if (req.headers.range) ranges.push(req.headers.range)
            const r = await handler(
              new Request(`lazunox-viewer://viewer${url.pathname}`, { headers: req.headers as Record<string, string> })
            )
            res.writeHead(r.status, Object.fromEntries(r.headers))
            if (r.body) Readable.fromWeb(r.body as any).pipe(res)
            else res.end()
            return
          }
          const path = url.pathname === '/' ? '/index.html' : url.pathname
          if (!/^\/(index\.html|assets\/[a-zA-Z0-9_.-]+)$/.test(path)) {
            res.writeHead(404).end()
            return
          }
          let bytes = await readFile(join(process.cwd(), 'out/viewer', path))
          const csp = VIEWER_CSP.replace('media-src lazunox-viewer://viewer', "media-src 'self'")
          if (path.endsWith('.html'))
            bytes = Buffer.from(
              bytes
                .toString()
                .replace('media-src lazunox-viewer://viewer', "media-src 'self'")
                .replace('</body>', args.includes('--serve') ? '<script src="/smoke-controls.js"></script></body>' : '</body>')
            )
          res.writeHead(200, {
            'content-type': path.endsWith('.html') ? 'text/html' : path.endsWith('.css') ? 'text/css' : 'text/javascript',
            'content-security-policy': csp
          })
          res.end(bytes)
        } catch {
          res.writeHead(404).end()
        }
      })
      await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
      const port = (server.address() as any).port
      if (args.includes('--serve')) {
        const url = `http://127.0.0.1:${port}/#t=${token}&kind=mp4&lang=es&theme=dark`
        report.limitation = 'Navegador existente con origen HTTP local; no valida sesión ni protocolo Electron.'
        console.log(`VISOR_URL=${url}`)
        await new Promise((done) => setTimeout(done, 70000))
        report.ok =
          !!report.seeked && !!report.playing && (report.initial as any)?.paused === true && (report.initial as any)?.muted === true
        server.closeAllConnections()
        await new Promise<void>((done) => server.close(() => done()))
        return
      }
      const req = createRequire(join(arg('--hyperframes'), 'package.json'))
      const puppeteer = req('puppeteer-core')
      let browser: any
      try {
        browser = await puppeteer.launch({
          executablePath: arg('--chrome'),
          headless: true,
          userDataDir: join(temp, 'chrome'),
          args: ['--no-sandbox', '--disable-background-networking']
        })
        const page = await browser.newPage()
        await page.setViewport({ width: 600, height: 960 })
        await page.goto(`http://127.0.0.1:${port}/#t=${token}&kind=mp4&lang=es&theme=dark`)
        await verify(
          (s) => page.evaluate(s),
          async () => Buffer.from(await page.screenshot())
        )
        report.ranges = ranges
        if (!ranges.length) throw Error('Chrome no pidió rangos')
      } finally {
        await browser?.close()
        server.closeAllConnections()
        await new Promise<void>((done) => server.close(() => done()))
      }
      report.limitation = 'Origen HTTP local en diagnóstico; no valida CSP ni sesión/protocolo Electron.'
    }
    if (args.includes('--ffmpeg'))
      report.preview = await videoPreview(
        file,
        (p) => {
          if (realpathSync(p) !== file) throw Error('fuera')
          return file
        },
        arg('--ffmpeg')
      ).then((p) => ({ duration: p?.duration, poster: !!p?.poster }))
    report.ok = true
  } catch (e) {
    report.ok = false
    report.error = e instanceof Error ? e.message : String(e)
    process.exitCode = 1
  } finally {
    report.fileBytes = (await (await import('node:fs/promises')).stat(file)).size
    writeFileSync(join(evidence, 'visor-informe.json'), JSON.stringify(report, null, 2))
    console.log(JSON.stringify(report))
    if (!node) app.exit(process.exitCode ?? 0)
  }
}
void main().catch((e) => {
  console.error(e)
  process.exitCode = 1
  if (app && 'exit' in app) app.exit(1)
})
