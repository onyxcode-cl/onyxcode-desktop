#!/usr/bin/env node
// `cloudflared` FALSO para pruebas del modo viaje: NO usa red, NO abre túneles. Acepta los mismos argumentos que el real
// (`tunnel --no-autoupdate --url http://127.0.0.1:P --metrics … --loglevel … --protocol …`), abre un proxy HTTP+WebSocket en
// 127.0.0.1:0 que reenvía a `--url` poniendo las cabeceras que Cloudflare puso en la prueba real T0 (`Host: <palabras>.trycloudflare.com`,
// `X-Forwarded-For`, `Cf-Connecting-Ip`, `Cf-Ray`, `X-Forwarded-Proto`, `Cf-Visitor`; sin `Sec-WebSocket-Extensions`), e imprime en
// STDERR (stdout siempre vacío) el banner con el formato real de cloudflared 2026.9.3.
//
// Modo por `FAKE_CF_MODE` (con `:valor` cuando lleva parámetro; varios separados por coma):
//   ok                 comportamiento normal
//   no-url             solo el aviso y «Requesting…»; nunca crea la URL (cuelga)
//   slow-url:<ms>      la URL aparece tras <ms>
//   no-register        URL sin «Registered tunnel connection»
//   two-urls           tras registrarse imprime una SEGUNDA URL distinta
//   bad-url            URL que no casa (con puerto)
//   exit-after:<ms>    muere (código 1) <ms> después de estar en línea
//   rate-after:<ms>    ya en línea, imprime un error 429 y muere a los <ms>
//   rate-429           error 429 al pedir el túnel y sale con 1
//   config-conflict    error de configuración y sale con 1
//   edge-down          error de conexión con el borde y sale con 1
//   ignore-sigterm     ignora SIGTERM (hay que remachar con SIGKILL)
//   spawn-grandchild   crea un nieto en OTRO grupo (imprime FAKE_GRANDCHILD_PID=)
//   garbage            salida basura y líneas larguísimas antes del banner
//   inject             altera `/` (index.html) inyectando un script (prueba de la autocomprobación)
//   ws-522:<n>         responde 522 a los n primeros upgrades de WebSocket
//   idle-cut:<ms>      corta un WebSocket sin tráfico en ningún sentido durante <ms> (como el borde: ~125 s)
//   unregister:<ms>    a los <ms> de estar en línea imprime «Unregistered…» y 400 ms después «Registered…»
//   host:<palabras>    nombre fijo (p. ej. host:alpha-beta-gamma-delta)
// Variables: FAKE_CF_IP (IP del visitante simulada, por defecto 203.0.113.9).
import { spawn } from 'node:child_process'
import { createServer, request } from 'node:http'
import { connect } from 'node:net'

const argv = process.argv.slice(2)
const modes = new Map(
  (process.env.FAKE_CF_MODE || 'ok').split(',').map((m) => {
    const i = m.indexOf(':')
    return i < 0 ? [m, ''] : [m.slice(0, i), m.slice(i + 1)]
  })
)
const has = (m) => modes.has(m)
const num = (m, d) => (modes.has(m) && modes.get(m) !== '' ? Number(modes.get(m)) : d)
const arg = (name) => {
  const i = argv.indexOf(name)
  return i >= 0 ? argv[i + 1] : undefined
}
const WORDS = [
  'horizontal',
  'aircraft',
  'tamil',
  'weekend',
  'merry',
  'plasma',
  'least',
  'recruitment',
  'ian',
  'hope',
  'consumption',
  'retired'
]
const randomHost = () => Array.from({ length: 4 }, () => WORDS[Math.floor(Math.random() * WORDS.length)]).join('-')
const words = modes.get('host') || randomHost()
const host = `${words}.trycloudflare.com`
const visitorIp = process.env.FAKE_CF_IP || '203.0.113.9'

const ts = () => new Date().toISOString().replace(/\.\d+Z$/, 'Z')
const log = (lvl, msg) => process.stderr.write(`${ts()} ${lvl} ${msg}\n`)
const raw = (line) => process.stderr.write(`${line}\n`)

if (!argv.includes('--no-autoupdate')) {
  log('FTL', 'FAKE: falta --no-autoupdate')
  process.exit(3)
}
if (argv[0] !== 'tunnel') {
  log('FTL', 'FAKE: se esperaba el subcomando tunnel')
  process.exit(3)
}
const target = arg('--url')
const tm = /^http:\/\/127\.0\.0\.1:(\d{1,5})$/.exec(target || '')
if (!tm) {
  log('FTL', 'FAKE: --url debe ser http://127.0.0.1:PUERTO')
  process.exit(3)
}
const targetPort = Number(tm[1])
raw(`FAKE_ARGV=${JSON.stringify(argv)}`)
raw(`FAKE_HOME=${process.env.HOME || ''}`)
if (argv.includes('--config')) log('ERR', `Configuration file ${arg('--config')} was empty`)

if (has('ignore-sigterm')) process.on('SIGTERM', () => log('INF', 'FAKE: SIGTERM ignorado'))
else {
  process.on('SIGTERM', () => {
    log('INF', 'Initiating graceful shutdown due to signal terminated ...')
    log('INF', 'no more connections active and exiting')
    process.exit(0)
  })
}
process.on('SIGINT', () => process.exit(0))

const NOTICE =
  'Thank you for trying Cloudflare Tunnel. Doing so, without a Cloudflare account, is a quick way to experiment and try it out. However, be aware that these account-less Tunnels have no uptime guarantee, are subject to the Cloudflare Online Services Terms of Use (https://www.cloudflare.com/website-terms/), and Cloudflare reserves the right to investigate your use of Tunnels for violations of such terms. If you intend to use Tunnels in production you should use a pre-created named tunnel by following: https://developers.cloudflare.com/cloudflare-one/connections/connect-apps'

// ── proxy ──
function fwdHeaders(h, extra = {}) {
  const out = { ...h }
  delete out['sec-websocket-extensions'] // el borde no pasa permessage-deflate
  out.host = host
  out['x-forwarded-for'] = h['x-test-ip'] || visitorIp
  out['cf-connecting-ip'] = h['x-test-ip'] || visitorIp
  out['x-forwarded-proto'] = 'https'
  out['cf-visitor'] = '{"scheme":"https"}'
  out['cf-ray'] = 'fake0123456789ab-SCL'
  out['cf-ipcountry'] = 'CL'
  delete out['x-test-ip']
  return { ...out, ...extra }
}
let wsAttempts = 0
const proxy = createServer((req, res) => {
  if (req.url.startsWith('/cdn-cgi/')) {
    res.writeHead(200, { 'content-type': 'text/plain' })
    return res.end('fake cdn-cgi')
  }
  const headers = fwdHeaders(req.headers)
  if (!has('inject')) headers['accept-encoding'] = req.headers['accept-encoding'] || 'identity'
  const up = request({ host: '127.0.0.1', port: targetPort, method: req.method, path: req.url, headers }, (r) => {
    if (has('inject') && (req.url === '/' || req.url.startsWith('/?')) && String(r.headers['content-type'] || '').includes('text/html')) {
      const chunks = []
      r.on('data', (c) => chunks.push(c))
      r.on('end', () => {
        const body = Buffer.from(
          Buffer.concat(chunks).toString('utf8').replace('</head>', '<script src="/cdn-cgi/evil.js"></script></head>')
        )
        const h = { ...r.headers, 'content-length': body.length }
        delete h['content-encoding']
        res.writeHead(r.statusCode, h)
        res.end(body)
      })
      return
    }
    res.writeHead(r.statusCode, r.headers)
    r.pipe(res)
  })
  up.on('error', () => {
    res.writeHead(502)
    res.end('Bad gateway')
  })
  req.pipe(up)
})
proxy.on('upgrade', (req, socket, head) => {
  wsAttempts++
  if (has('ws-522') && wsAttempts <= num('ws-522', 1)) {
    socket.write('HTTP/1.1 522 \r\nContent-Length: 0\r\nConnection: close\r\n\r\n')
    return socket.destroy()
  }
  const up = connect(targetPort, '127.0.0.1')
  const h = fwdHeaders(req.headers)
  let headText = `${req.method} ${req.url} HTTP/1.1\r\n`
  for (const [k, v] of Object.entries(h)) headText += `${k}: ${v}\r\n`
  headText += '\r\n'
  up.on('connect', () => {
    up.write(headText)
    if (head?.length) up.write(head)
  })
  let last = Date.now()
  const touch = () => (last = Date.now())
  socket.on('data', touch)
  up.on('data', touch)
  up.pipe(socket)
  socket.pipe(up)
  const cut = num('idle-cut', 0)
  let timer = null
  if (cut > 0)
    timer = setInterval(
      () => {
        if (Date.now() - last > cut) {
          socket.destroy()
          up.destroy()
        }
      },
      Math.max(20, cut / 10)
    )
  const end = () => {
    if (timer) clearInterval(timer)
    socket.destroy()
    up.destroy()
  }
  socket.on('error', end)
  up.on('error', end)
  socket.on('close', end)
  up.on('close', end)
})
proxy.listen(0, '127.0.0.1', () => {
  raw(`FAKE_PROXY_PORT=${proxy.address().port}`)
  start()
})

// ── guion de salida ──
function start() {
  if (has('garbage')) {
    process.stderr.write(Buffer.from([0xff, 0xfe, 0x00, 0x01, 0x0a]))
    raw('\x1b[31m%%%% not a log line @@@@')
    raw('x'.repeat(100_000))
    raw(`${ts()} INF Thank you https://www.cloudflare.com/website-terms/ and trycloudflare.com`)
  }
  log('INF', NOTICE)
  if (has('rate-429')) {
    log('INF', 'Requesting new quick Tunnel on trycloudflare.com...')
    log('ERR', 'failed to request quick Tunnel: Post "https://api.trycloudflare.com/tunnel": 429 Too Many Requests')
    return process.exit(1)
  }
  if (has('edge-down')) {
    log('INF', 'Requesting new quick Tunnel on trycloudflare.com...')
    log('ERR', 'failed to request quick Tunnel: dial tcp: lookup api.trycloudflare.com: no such host')
    return process.exit(1)
  }
  if (has('config-conflict')) {
    log('ERR', 'Configuration file /etc/cloudflared/config.yml is invalid: cannot unmarshal')
    return process.exit(1)
  }
  log('INF', 'Requesting new quick Tunnel on trycloudflare.com...')
  if (has('no-url')) return
  setTimeout(
    () => {
      const url = has('bad-url') ? `https://${words}.trycloudflare.com:8443` : `https://${host}`
      log('INF', '+--------------------------------------------------------------------------------------------+')
      log('INF', '|  Your quick Tunnel has been created! Visit it at (it may take some time to be reachable):  |')
      log('INF', `|  ${url.padEnd(90)}|`)
      log('INF', '+--------------------------------------------------------------------------------------------+')
      log(
        'INF',
        'Cannot determine default configuration path. No file [config.yml config.yaml] in [~/.cloudflared ~/.cloudflare-warp ~/cloudflare-warp /etc/cloudflared /usr/local/etc/cloudflared]'
      )
      log('INF', 'Version 2026.9.3 (Checksum 5472c1a01c84bc31b3021056a73b4e5774ddddefc572124ea8fdf6c340639f32)')
      log(
        'INF',
        `Settings: map[ha-connections:1 loglevel:info metrics:127.0.0.1:0 no-autoupdate:true p:auto protocol:auto url:http://127.0.0.1:${targetPort}]`
      )
      log('INF', 'Initial protocol quic')
      if (has('spawn-grandchild')) {
        const g = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { detached: true, stdio: 'ignore' })
        g.unref()
        raw(`FAKE_GRANDCHILD_PID=${g.pid}`)
      }
      if (has('bad-url')) return
      if (has('no-register')) return
      setTimeout(() => {
        log(
          'INF',
          'Registered tunnel connection connIndex=0 connection=81b02989-0668-4437-9f6d-efdf74527780 event=0 ip=198.41.192.67 location=gig10 protocol=quic'
        )
        if (has('two-urls')) setTimeout(() => log('INF', '|  https://other-host-here-now.trycloudflare.com  |'), 50)
        if (has('rate-after'))
          setTimeout(
            () => {
              log('ERR', 'failed to request quick Tunnel: 429 Too Many Requests')
              process.exit(1)
            },
            num('rate-after', 100)
          )
        if (has('exit-after'))
          setTimeout(
            () => {
              log('ERR', 'Connection terminated error="context canceled"')
              process.exit(1)
            },
            num('exit-after', 100)
          )
        if (has('unregister')) {
          setTimeout(() => log('INF', 'Unregistered tunnel connection connIndex=0'), num('unregister', 200))
          setTimeout(
            () =>
              log(
                'INF',
                'Registered tunnel connection connIndex=0 connection=81b02989-0668-4437-9f6d-efdf74527780 event=0 ip=198.41.192.67 location=gig10 protocol=quic'
              ),
            num('unregister', 200) + 400
          )
        }
      }, 20)
    },
    num('slow-url', 10)
  )
}
