// Sonda de la terminal integrada de la app EMPAQUETADA (Windows): se conecta por CDP (--remote-debugging-port, que no es el
// inspector de Node y sigue disponible con los fuses) a la ventana principal y, por la API del preload (window.api.code.pty),
// abre una terminal, escribe un comando de PowerShell y espera su salida. Solo pruebas; uso:
//   node pty-probe.mjs <puerto> <cwd>      (necesita Node 22: WebSocket global)
const [port, cwd] = [process.argv[2] ?? '9333', process.argv[3] ?? 'C:\\onyx\\tmp']
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function pages() {
  const r = await fetch(`http://127.0.0.1:${port}/json/list`)
  return r.json()
}
let target
for (let i = 0; i < 60 && !target; i++) {
  try {
    target = (await pages()).find((p) => p.type === 'page' && /index\.html/.test(p.url) && !/quick|overlay|pill/.test(p.url))
  } catch {}
  if (!target) await sleep(1000)
}
if (!target) {
  console.log('PROBE FAIL sin pagina principal')
  process.exit(2)
}
const ws = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((ok, ko) => ((ws.onopen = ok), (ws.onerror = ko)))
let id = 0
const pending = new Map()
ws.onmessage = (m) => {
  const d = JSON.parse(m.data)
  if (d.id && pending.has(d.id)) pending.get(d.id)(d)
}
const send = (method, params) =>
  new Promise((ok) => {
    const n = ++id
    pending.set(n, ok)
    ws.send(JSON.stringify({ id: n, method, params }))
  })
const expr = `(async () => {
  const api = window.api.code
  let out = ''
  const off = api.onPtyData((e) => { out += e.data ?? '' })
  const info = await api.pty.create({ cwd: ${JSON.stringify(cwd)}, cols: 100, rows: 30 })
  await new Promise((r) => setTimeout(r, 2500))
  await api.pty.write(info.id, 'Write-Output ("ONYX" + "-PTY-" + (40+2)); $PSVersionTable.PSVersion.Major\\r')
  const t0 = Date.now()
  while (!/ONYX-PTY-42/.test(out.replace(/\\x1b\\[[0-9;?]*[A-Za-z]/g, '')) && Date.now() - t0 < 15000) await new Promise((r) => setTimeout(r, 300))
  const ok = /ONYX-PTY-42/.test(out.replace(/\\x1b\\[[0-9;?]*[A-Za-z]/g, ''))
  await api.pty.kill(info.id).catch(() => {})
  off && off()
  return JSON.stringify({ ok, pid: info.pid, shell: info.shell, tail: out.replace(/\\x1b\\[[0-9;?]*[A-Za-z]/g, '').slice(-200) })
})()`
const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })
console.log('PROBE ' + (r.result?.result?.value ?? JSON.stringify(r.result)))
// Cierra la ventana como lo haria el usuario (en la v1 de Windows, ventana cerrada = la app sale).
if (process.argv[4] === 'close') {
  ws.send(JSON.stringify({ id: ++id, method: 'Runtime.evaluate', params: { expression: 'setTimeout(() => window.close(), 50)' } }))
  await sleep(500)
}
ws.close()
process.exit(r.result?.result?.value && JSON.parse(r.result.result.value).ok ? 0 : 1)
