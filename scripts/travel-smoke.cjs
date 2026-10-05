'use strict'
/**
 * Prueba de humo REAL del «Modo viaje»: corre DENTRO de Electron, con red real y el `cloudflared` oficial. NO se ejecuta en
 * `npm test` ni en `npm run verify` (descarga ~20 MB y abre UN túnel rápido de Cloudflare de pocos minutos). La corre una persona
 * a mano o un agente expresamente autorizado.
 *
 * Qué recorre, con los componentes de producción (sin dobles):
 *   1. `CloudflaredBinary` + `createManualFetch` (net.request de Electron): descarga de la release oficial hacia un userData TEMPORAL,
 *      `tar`, los dos SHA-256 del pin, `codesign` con el requisito Developer ID de Cloudflare, y el binario se ejecuta SIN diálogo de
 *      Gatekeeper (`--version` con plazo).
 *   2. `TunnelSignalingTransport` + `CloudflaredProcess` reales: vigía `/bin/sh`, `withDisclaim`, `HOME` privado, `--no-autoupdate`,
 *      URL `https://<palabras>.trycloudflare.com` de `stderr`, autocomprobación (el Mac pide su propia página por el túnel y la compara).
 *   3. Rutas expuestas por el túnel: puerta `/k/<T>` (303 + galleta `__Host-onyxk`), 404 idéntico sin galleta, `/cdn-cgi/`, PWA con galleta.
 *   4. WebSocket de señalización por el túnel (`wss://<host>/ws`) con la galleta y el `Origin` exacto: `hello` → `ready`, `Origin`
 *      ajeno y sin galleta rechazados, y los pings del Mac (keepalive) durante `--ping-wait` segundos.
 *   5. Cierre limpio: sin procesos `cloudflared`/vigía/`cat` huérfanos (se compara por pid antes y después) y `pids.json` vacío.
 *
 * Uso (desde la raíz del repo, Node 22 en el PATH; usa SIEMPRE un userData temporal, nunca el de la app instalada):
 *   TRAVEL_SMOKE_OUT=/tmp/travel-smoke.jsonl perl -e 'alarm shift; exec @ARGV' 300 \
 *     node_modules/electron/dist/Electron.app/Contents/MacOS/Electron --use-mock-keychain \
 *     --user-data-dir=/tmp/onyx-travel-smoke-ud scripts/travel-smoke.cjs [--ping-wait=55] [--no-tunnel]
 *   Los resultados van a TRAVEL_SMOKE_OUT (una línea JSON por paso; el último paso es `summary`), no a stdout. No abre ventanas y
 *   termina solo. `perl alarm` NO mata a los hijos: el vigía de `cloudflared` los mata, pero comprueba con `pgrep -fl cloudflared`.
 *   TRAVEL_SMOKE_REUSE_BIN=<carpeta bin de una ejecución anterior> evita repetir la descarga (se copia y se verifica igual: hash y firma).
 *   Al terminar BORRA el binario descargado; borra tú el userData temporal.
 */
const { app, net } = require('electron')
const { execFileSync, spawnSync } = require('node:child_process')
const crypto = require('node:crypto')
const fs = require('node:fs')
const https = require('node:https')
const os = require('node:os')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..')
const OUT = process.env.TRAVEL_SMOKE_OUT || path.join(os.tmpdir(), 'travel-smoke.jsonl')
const args = process.argv.slice(2)
const argVal = (k, d) => (args.find((a) => a.startsWith(`--${k}=`)) || `--${k}=${d}`).split('=')[1]
const PING_WAIT_S = Number(argVal('ping-wait', '55'))
const NO_TUNNEL = args.includes('--no-tunnel')

fs.writeFileSync(OUT, '')
const results = []
const log = (step, ok, detail) => {
  const rec = { step, ok, ...(detail === undefined ? {} : { detail }), t: new Date().toISOString() }
  results.push(rec)
  fs.appendFileSync(OUT, `${JSON.stringify(rec)}\n`)
}
const sh = (cmd, a) => spawnSync(cmd, a, { encoding: 'utf8', timeout: 20_000 })
const sha256 = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** `ps` completo: pid, ppid, pgid y comando. */
function procs() {
  const out = sh('/bin/ps', ['-A', '-o', 'pid=,ppid=,pgid=,command=']).stdout || ''
  return out
    .split('\n')
    .map((l) => /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/.exec(l))
    .filter(Boolean)
    .map((m) => ({ pid: +m[1], ppid: +m[2], pgid: +m[3], command: m[4] }))
}
const cloudflaredProcs = () => procs().filter((p) => /cloudflared/.test(p.command) && !/travel-smoke/.test(p.command))

/** Bundle de los módulos reales de producción (TypeScript) para Electron, sin tocar node_modules ni el repo. */
function bundle(tmp) {
  const esbuild = require(path.join(ROOT, 'node_modules', 'esbuild'))
  const outfile = path.join(tmp, 'travel-smoke-bundle.cjs')
  esbuild.buildSync({
    stdin: {
      contents: `
        export { CloudflaredBinary, realRun } from './src/main/remote/tunnel/binary'
        export { CLOUDFLARED_PIN } from './src/main/remote/tunnel/pin'
        export { createManualFetch } from './src/main/remote/tunnel/manual-fetch'
        export { realCloudflaredDeps } from './src/main/remote/tunnel/real-deps'
        export { TunnelSignalingTransport } from './src/main/remote/signaling/tunnel-transport'
        export { killStaleServers } from './src/main/opencode/pids'
        export { makeTunnelLookup } from './src/main/remote/signaling/tunnel-dns'
        export { realHttpGet, runSelfCheck } from './src/main/remote/signaling/tunnel-selfcheck'
        export { default as WebSocket } from 'ws'
      `,
      resolveDir: ROOT,
      loader: 'ts'
    },
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    outfile,
    external: ['electron', 'bufferutil', 'utf-8-validate'],
    alias: { '@shared': path.join(ROOT, 'src/shared') },
    logLevel: 'error'
  })
  return require(outfile)
}

/** GET por HTTPS (como la autocomprobación de producción), con cabeceras y sin seguir redirecciones. */
let lookup = null
function get(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url)
    const req = https.request(
      { host: u.hostname, port: 443, path: u.pathname + u.search, method: 'GET', headers, timeout: 15_000, lookup },
      (res) => {
        const chunks = []
        res.on('data', (c) => chunks.push(c))
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }))
      }
    )
    req.on('timeout', () => req.destroy(new Error('timeout')))
    req.on('error', reject)
    req.end()
  })
}

function wsOpen(WebSocket, url, headers) {
  return new Promise((resolve) => {
    const ws = new WebSocket(url, { headers, handshakeTimeout: 15_000, lookup })
    ws.once('open', () => resolve({ ws }))
    ws.once('unexpected-response', (_req, res) => {
      res.resume()
      resolve({ status: res.statusCode })
    })
    ws.once('error', (e) => resolve({ error: String(e.message || e) }))
  })
}

async function main() {
  const userData = app.getPath('userData')
  log('env', true, { electron: process.versions.electron, node: process.versions.node, userData, pingWaitS: PING_WAIT_S })
  if (!userData.startsWith(os.tmpdir()) && !userData.includes('/private/tmp/') && !userData.includes('scratchpad')) {
    log('guard', false, 'userData no es temporal: se aborta para no tocar datos reales')
    return
  }
  const mod = bundle(fs.mkdtempSync(path.join(os.tmpdir(), 'onyx-smoke-bundle-')))
  log('bundle', true)
  lookup = mod.makeTunnelLookup()
  const pin = mod.CLOUDFLARED_PIN
  if (!pin) return log('pin', false, 'pin.json no válido')
  const asset = pin.assets['darwin-arm64']
  const before = cloudflaredProcs().map((p) => p.pid)
  log('baseline-procs', before.length === 0, { cloudflared: before })

  const audits = []
  const binDir = path.join(userData, 'bin')
  const binary = new mod.CloudflaredBinary({
    pin,
    binDir,
    fetch: mod.createManualFetch(net),
    audit: (e) => audits.push(e.kind)
  })
  log('binary-initial-state', binary.quickState() === 'missing', binary.quickState())

  // ── 1. Descarga real, extracción, hashes y firma ──
  let installed = null
  const reuse = process.env.TRAVEL_SMOKE_REUSE_BIN
  try {
    const t0 = Date.now()
    if (reuse) {
      fs.cpSync(reuse, binDir, { recursive: true })
      installed = binary.installedPath()
      log('install', true, { reused: reuse, note: 'sin descarga (TRAVEL_SMOKE_REUSE_BIN)' })
    } else {
      let last = 0
      installed = await binary.install({ consent: true, onProgress: (d) => (last = d) })
      log('install', true, { ms: Date.now() - t0, bytes: last, path: installed, expectedSize: asset.size })
    }
  } catch (err) {
    log('install', false, { code: err && err.code, message: String(err && err.message) })
    return
  }
  const leftovers = fs.readdirSync(binDir).filter((n) => n.startsWith('.partial'))
  log('install-no-partials', leftovers.length === 0, leftovers)
  const st = fs.lstatSync(installed)
  log('bin-file', st.isFile() && (st.mode & 0o777) === 0o700 && st.size === asset.binSize, {
    size: st.size,
    mode: (st.mode & 0o777).toString(8)
  })
  log('bin-sha256', sha256(installed) === asset.binSha256, sha256(installed))
  log('state-verify', (await binary.verifyInstalled()) === 'ready')
  log('signature', await binary.checkSignature(installed))
  const cs = sh('/usr/bin/codesign', ['-dvv', installed])
  log(
    'codesign-details',
    /TeamIdentifier=68WVV388M8/.test(cs.stderr) && /Developer ID Application: Cloudflare Inc\./.test(cs.stderr),
    (cs.stderr || '').split('\n').filter((l) => /Authority|TeamIdentifier|Identifier=|flags/.test(l))
  )
  const xa = sh('/usr/bin/xattr', ['-l', installed])
  log('no-quarantine', !/com\.apple\.quarantine/.test(xa.stdout), xa.stdout.trim())
  const ver = sh(installed, ['--version'])
  log('exec-no-gatekeeper', ver.status === 0 && /cloudflared version/.test(ver.stdout), {
    status: ver.status,
    signal: ver.signal,
    out: (ver.stdout || '').trim().slice(0, 120)
  })
  try {
    log('ensureReady', (await binary.ensureReady()) === installed)
  } catch (err) {
    log('ensureReady', false, String(err && err.code))
    return
  }

  if (NO_TUNNEL) return
  // ── 2. Túnel real por el ciclo de vida de producción ──
  const lines = []
  const selfCheckLog = []
  const loggingGet = async (url, headers) => {
    const t0 = Date.now()
    try {
      const r = await mod.realHttpGet(url, headers)
      selfCheckLog.push({ url: url.replace(/\/\/[^/]+/, '//<host>'), status: r.status, bytes: r.body.length, ms: Date.now() - t0 })
      return r
    } catch (err) {
      selfCheckLog.push({ url: url.replace(/\/\/[^/]+/, '//<host>'), error: String(err && err.message), ms: Date.now() - t0 })
      throw err
    }
  }
  const spawnedAt = Date.now()
  const transport = new mod.TunnelSignalingTransport({
    pwaDir: path.join(ROOT, 'pwa', 'dist'),
    ensureBinary: () => binary.ensureReady(),
    homeDir: path.join(userData, 'cloudflared', 'home'),
    deps: mod.realCloudflaredDeps,
    audit: (e) => audits.push(e.kind),
    // La autocomprobación de producción (`runSelfCheck`), con registro de cada petición; si no da `ok` el túnel se mantiene para poder
    // seguir diagnosticando y se anota como fallo (`selfcheck-production`).
    selfCheck: async (ctx) => {
      const t0 = Date.now()
      const verdict = await mod.runSelfCheck(ctx.origin, ctx.token, {
        get: loggingGet,
        expected: ctx.expected,
        issueNonce: ctx.issueNonce,
        maxMs: 40_000
      })
      log('selfcheck-production', verdict === 'ok', { verdict, ms: Date.now() - t0, requests: selfCheckLog.slice(0, 14) })
      return 'ok'
    },
    onProcessLine: (l) =>
      lines.push(`+${Date.now() - spawnedAt}ms ` + l.replace(/https:\/\/\S*trycloudflare\.com/g, 'https://<host>').slice(0, 300))
  })
  const peers = []
  transport.onPeer((p) => peers.push(p))
  const phases = []
  transport.onStatus((s) => phases.push(`${transport.phase()}/${s}`))
  const DEVICE = 'ab'.repeat(16)
  let origin = null
  let token = null
  try {
    const t0 = Date.now()
    const r = await transport.start({ authorize: (h) => h.mode === 'resume' && h.deviceId === DEVICE })
    origin = r.origin
    token = transport.travelToken()
    log('tunnel-start', /^https:\/\/[a-z0-9]+(-[a-z0-9]+){1,7}\.trycloudflare\.com$/.test(origin), {
      ms: Date.now() - t0,
      host: new URL(origin).host,
      phase: transport.phase(),
      status: transport.status()
    })
  } catch (err) {
    log('tunnel-start', false, {
      code: err && err.code,
      message: String(err && err.message),
      selfCheck: selfCheckLog.slice(0, 12),
      lines: lines.filter((l) => !/PASS|\|/.test(l)).slice(-15)
    })
    await transport.stop().catch(() => undefined)
    return
  }
  const cfProcs = cloudflaredProcs()
  const guard = cfProcs.find((p) => /\/bin\/sh|onyxcode-disclaim/.test(p.command) && /--no-autoupdate/.test(p.command))
  const real = cfProcs.find(
    (p) => /cloudflared tunnel|cloudflared$/.test(p.command.split(' ').slice(0, 2).join(' ')) || /\/cloudflared tunnel/.test(p.command)
  )
  log(
    'process-tree',
    cfProcs.length >= 1,
    cfProcs.map((p) => ({ pid: p.pid, ppid: p.ppid, pgid: p.pgid, command: p.command.replace(userData, '<ud>').slice(0, 200) }))
  )
  log(
    'args',
    cfProcs.some(
      (p) => /--no-autoupdate/.test(p.command) && /--url http:\/\/127\.0\.0\.1:\d+/.test(p.command) && !/--config/.test(p.command)
    ),
    null
  )
  log(
    'log-lines',
    lines.some((l) => /Registered tunnel connection/.test(l)) && lines.some((l) => /Your quick Tunnel has been created/.test(l)),
    lines.slice(0, 12)
  )
  log(
    'home-private',
    fs.existsSync(path.join(userData, 'cloudflared', 'home')) &&
      (fs.statSync(path.join(userData, 'cloudflared', 'home')).mode & 0o777) === 0o700
  )

  // ── 3. Rutas por el túnel ──
  const indexLocal = fs.readFileSync(path.join(ROOT, 'pwa', 'dist', 'index.html'))
  const nf = await get(`${origin}/`)
  log('no-cookie-404', nf.status === 404 && nf.body.toString() === 'Not found', {
    status: nf.status,
    body: nf.body.toString().slice(0, 60)
  })
  const bad = await get(`${origin}/k/${'A'.repeat(22)}`)
  log('bad-token-404-identical', bad.status === 404 && bad.body.toString() === nf.body.toString(), { status: bad.status })
  const gate = await get(`${origin}/k/${token}`)
  const sc = [].concat(gate.headers['set-cookie'] || [])[0] || ''
  log(
    'gate-303-cookie',
    gate.status === 303 &&
      gate.headers.location === '/' &&
      /^__Host-onyxk=/.test(sc) &&
      /Secure/.test(sc) &&
      /HttpOnly/.test(sc) &&
      !/Domain/i.test(sc),
    { status: gate.status, location: gate.headers.location, cookieAttrs: sc.replace(token, '<T>') }
  )
  const cookie = sc.split(';')[0]
  const page = await get(`${origin}/`, { Cookie: cookie, 'Accept-Encoding': 'identity' })
  log('pwa-with-cookie', page.status === 200 && Buffer.compare(page.body, indexLocal) === 0, {
    status: page.status,
    bytes: page.body.length,
    csp: String(page.headers['content-security-policy'] || '').match(/connect-src[^;]*/)?.[0]
  })
  const cdn = await get(`${origin}/cdn-cgi/trace`)
  log('cdn-cgi-by-cloudflare', cdn.status === 200 && /colo=/.test(cdn.body.toString()), { status: cdn.status })
  const probe = await get(`${origin}/__onyx/probe/${'B'.repeat(22)}`)
  log('probe-wrong-nonce-404', probe.status === 404)
  const env = await get(`${origin}/.env`, { Cookie: cookie })
  log('dotfile-404', env.status === 404)

  // ── 4. WebSocket de señalización por el túnel ──
  const wsUrl = origin.replace('https://', 'wss://') + '/ws'
  const noCookie = await wsOpen(mod.WebSocket, wsUrl, { Origin: origin })
  log('ws-no-cookie-rejected', noCookie.status === 404, noCookie)
  const badOrigin = await wsOpen(mod.WebSocket, wsUrl, { Origin: 'https://evil.example', Cookie: cookie })
  log('ws-bad-origin-rejected', badOrigin.status === 404, badOrigin)
  const opened = await wsOpen(mod.WebSocket, wsUrl, { Origin: origin, Cookie: cookie })
  if (!opened.ws) {
    log('ws-open', false, opened)
  } else {
    const ws = opened.ws
    let pings = 0
    ws.on('ping', () => pings++)
    const got = new Promise((resolve) => ws.once('message', (d) => resolve(d.toString())))
    ws.send(JSON.stringify({ t: 'hello', v: 4, mode: 'resume', deviceId: DEVICE }))
    const first = await Promise.race([got, sleep(10_000).then(() => null)])
    log('ws-hello-ready', first === '{"t":"ready"}' && peers.length === 1, { first, peers: peers.length })
    const t0 = Date.now()
    await sleep(PING_WAIT_S * 1000)
    log('ws-keepalive-pings', PING_WAIT_S < 30 || pings >= 1, {
      pings,
      seconds: Math.round((Date.now() - t0) / 1000),
      open: ws.readyState === 1
    })
    ws.close()
    await sleep(500)
  }
  log('proc-alive-after-traffic', transport.status() === 'online', { phase: transport.phase(), status: transport.status() })

  // ── 5. Cierre limpio ──
  const treePids = cloudflaredProcs().map((p) => p.pid)
  const t1 = Date.now()
  await transport.stop()
  await sleep(1500)
  const after = cloudflaredProcs()
  log('stop-clean', after.length === 0, { stopMs: Date.now() - t1, was: treePids, left: after.map((p) => p.pid) })
  const deadHost = await get(`${origin}/`).catch((e) => ({ status: String(e.message) }))
  log('url-dead-after-stop', deadHost.status !== 200, { status: deadHost.status })
  let pidsJson = []
  try {
    pidsJson = JSON.parse(fs.readFileSync(path.join(userData, 'pids.json'), 'utf8'))
  } catch {
    /* no existe */
  }
  log('pids-json-empty', pidsJson.length === 0, pidsJson)
  log('audits', true, audits)
  log('phases', true, phases.slice(0, 20))
  void real
  void guard
}

app.whenReady().then(async () => {
  app.dock?.hide?.()
  const killer = setTimeout(() => {
    log('timeout', false, 'plazo interno agotado')
    finish(2)
  }, 270_000)
  killer.unref()
  try {
    await main()
  } catch (err) {
    log('exception', false, String((err && err.stack) || err))
  }
  finish(results.every((r) => r.ok) ? 0 : 1)
})

function finish(code) {
  // Borra el binario descargado (y su carpeta) y comprueba que no quede nada de `cloudflared`.
  try {
    if (process.env.TRAVEL_SMOKE_KEEP_BIN !== '1') fs.rmSync(path.join(app.getPath('userData'), 'bin'), { recursive: true, force: true })
  } catch {
    /* nada */
  }
  const left = cloudflaredProcs()
  const ok = results.every((r) => r.ok) && left.length === 0
  fs.appendFileSync(
    OUT,
    `${JSON.stringify({ step: 'summary', ok, failed: results.filter((r) => !r.ok).map((r) => r.step), leftoverProcs: left.map((p) => p.pid) })}\n`
  )
  void execFileSync
  app.exit(ok ? 0 : code || 1)
}
