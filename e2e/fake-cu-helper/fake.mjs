#!/usr/bin/env node
/**
 * Helper FALSO de Control del PC (`cu-helper` / `cu-helper.exe`) para pruebas: emula el protocolo de línea de comandos + JSON de
 * `resources/computer-use/protocol.json` SIN tocar el ratón, el teclado ni la pantalla (nada nativo, sin Windows).
 *
 * Qué valida (como lo haría el helper real): comando conocido para la plataforma emulada, banderas globales (`--instant`,
 * `--char-delay N`), argumentos obligatorios (variádicos incluidos) y que el código de salida pedido exista en el contrato.
 * Qué hace: registra cada llamada (una línea JSON en `FAKE_CU_LOG`) y responde con un guion.
 *
 * Variables de entorno (todas opcionales):
 *   FAKE_CU_PLATFORM  `darwin` (por defecto) o `win32`: define qué comandos existen (contrato `win32: none|replaced`, extensiones).
 *   FAKE_CU_SCRIPT    JSON `{ "responses": { "<comando>": R | R[] } }`. Una lista se consume de uno en uno y repite el último.
 *                     (Las listas de respuestas se consumen UNA POR LLAMADA, con el contador en `<guion>.state`.)
 *                     R = `{ "out": <json> }` (stdout) | `{ "raw": "texto" }` | `{ "exit": n, "stderr": "…" } ` | `{ "pad": bytes }`
 *                     (emite esa cantidad de bytes: prueba el tope de salida) | `{ "sleepMs": n, "then": R }` (espera; STOP/EOF por
 *                     stdin o SIGTERM la corta con salida 3, como el helper real) | `{ "writeImage": true, … }` (copia
 *                     `FAKE_CU_IMAGE` —o un JPEG mínimo— al argumento de salida del comando antes de responder).
 *   FAKE_CU_LOG       archivo `calls.jsonl`: `{ "cmd", "args", "flags" }` por llamada y `{ "event": "stop"|"sigterm" }` al parar.
 *   FAKE_CU_IMAGE     imagen que copian los comandos que escriben una captura (`screenshot`, `window-shot`, `screenshot-sck`).
 *
 * Sin guion: respuestas por defecto razonables (ver DEFAULTS). Nunca sale con 0 si el comando no existe: sale con 1 y stderr.
 */
import { appendFileSync, copyFileSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const protocol = JSON.parse(readFileSync(join(here, '..', '..', 'resources', 'computer-use', 'protocol.json'), 'utf8'))
const platform = process.env.FAKE_CU_PLATFORM === 'win32' ? 'win32' : 'darwin'
const logFile = process.env.FAKE_CU_LOG ?? ''
const scriptFile = process.env.FAKE_CU_SCRIPT ?? ''

/** JPEG de 16x16 (771 bytes) para las capturas que escribe el helper falso cuando no hay `FAKE_CU_IMAGE`. */
const TINY_JPEG_B64 =
  '/9j/4AAQSkZJRgABAQAASABIAAD/4QBMRXhpZgAATU0AKgAAAAgAAYdpAAQAAAABAAAAGgAAAAAAA6ABAAMAAAABAAEAAKACAAQAAAABAAAAEKADAAQAAAABAAAAEAAAAAD/7QA4UGhvdG9zaG9wIDMuMAA4QklNBAQAAAAAAAA4QklNBCUAAAAAABDUHYzZjwCyBOmACZjs+EJ+/8AAEQgAEAAQAwEiAAIRAQMRAf/EAB8AAAEFAQEBAQEBAAAAAAAAAAABAgMEBQYHCAkKC//EALUQAAIBAwMCBAMFBQQEAAABfQECAwAEEQUSITFBBhNRYQcicRQygZGhCCNCscEVUtHwJDNicoIJChYXGBkaJSYnKCkqNDU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6g4SFhoeIiYqSk5SVlpeYmZqio6Slpqeoqaqys7S1tre4ubrCw8TFxsfIycrS09TV1tfY2drh4uPk5ebn6Onq8fLz9PX29/j5+v/EAB8BAAMBAQEBAQEBAQEAAAAAAAABAgMEBQYHCAkKC//EALURAAIBAgQEAwQHBQQEAAECdwABAgMRBAUhMQYSQVEHYXETIjKBCBRCkaGxwQkjM1LwFWJy0QoWJDThJfEXGBkaJicoKSo1Njc4OTpDREVGR0hJSlNUVVZXWFlaY2RlZmdoaWpzdHV2d3h5eoKDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uLj5OXm5+jp6vLz9PX29/j5+v/bAEMAAgICAgICBAICBAYEBAQGCAYGBgYICggICAgICgwKCgoKCgoMDAwMDAwMDA4ODg4ODhAQEBAQEhISEhISEhISEv/bAEMBAwMDBQQFCAQECBMNCw0TExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTE//dAAQAAf/aAAwDAQACEQMRAD8AKKKKAP/Z'

const DEFAULTS = {
  version: { out: { protocol: 1, helper: 'fake-1.0.0', platform } },
  cursor: { out: { x: 10, y: 20 } },
  screens: { out: [{ width: 1440, height: 900, scale: 2, x: 0, y: 0, main: true }] },
  permissions: { out: { accessibility: true, screenRecording: true } },
  frontmost: { out: { name: 'Notes', bundleId: 'com.apple.Notes', pid: 100 } },
  'app-at': { out: { name: 'Notes', bundleId: 'com.apple.Notes', pid: 100 } },
  'running-apps': { out: [] },
  'list-apps': { out: [] },
  'windows-of': { out: [] },
  'focused-secure': { out: { secure: false } },
  'recent-input': { out: { keyDownSeconds: 60 } },
  'resolve-app': { out: { name: 'Notes', bundleId: 'com.apple.Notes', found: true } },
  activate: { out: { ok: true, activated: true, hasWindow: true } },
  session: { out: { interactive: true, secureDesktop: false, elevatedTarget: false } },
  'release-input': { out: { ok: true } },
  screenshot: { writeImage: true, out: { width: 1366, height: 854, ratio: 1.0541, masked: 0 } },
  'window-shot': {
    writeImage: true,
    out: {
      ok: true,
      width: 800,
      height: 600,
      title: 'Ventana',
      x: 100,
      y: 80,
      srcWidth: 800,
      srcHeight: 600,
      frame: { x: 100, y: 80, width: 800, height: 600 },
      // Aviso de ventana tapada del helper de Windows: por defecto nada la tapa (las pruebas guionan `covered`).
      covered: [],
      coveredPct: 0
    }
  },
  'screenshot-sck': { writeImage: true, out: { ok: true, width: 2880, height: 1800 } },
  'ax-tree': { out: { app: {}, nodes: [], truncated: false } },
  'ax-find': { out: { matches: [] } },
  'ax-frame': { out: { frame: { x: 0, y: 0, width: 10, height: 10 } } },
  'find-elements': { out: [] },
  'hide-apps': { out: { hidden: [] } },
  'unhide-apps': { out: { unhidden: [] } }
}

const lookup = (cmd) => {
  const c = protocol.commands[cmd]
  if (c) return platform === 'win32' && (c.win32 === 'none' || c.win32 === 'replaced') ? null : c
  if (platform === 'win32') return protocol.windowsExtensions[cmd] ?? null
  return null
}

function log(entry) {
  if (!logFile) return
  try {
    appendFileSync(logFile, JSON.stringify(entry) + '\n')
  } catch {
    // sin registro
  }
}

function fail(code, message) {
  process.stderr.write(message + '\n')
  process.exit(code)
}

// ── argumentos: banderas globales, comando y posicionales ──
const argv = process.argv.slice(2)
const flags = []
while (argv.length) {
  if (argv[0] === '--instant') flags.push(argv.shift())
  else if (argv[0] === '--char-delay') {
    flags.push(argv.shift(), argv.shift() ?? '')
  } else if (argv[0].startsWith('--char-delay=')) flags.push(argv.shift())
  else break
}
const cmd = argv.shift() ?? ''
const args = argv
log({ cmd, args, flags })

const def = lookup(cmd)
if (!def) fail(1, `Comando desconocido o no disponible en ${platform}: ${cmd || '(vacío)'}`)

// Los comandos con banderas propias (`--app x`, `--max-long N`) llevan valores: se cuentan solo los posicionales.
const flagDefs = [...(def.flags ?? []), ...(platform === 'win32' ? (def.win32Flags ?? []) : [])]
const own = new Map(flagDefs.map((f) => [f.name, f]))
const positional = []
for (let i = 0; i < args.length; i++) {
  const f = own.get(args[i])
  if (f) {
    if (f.takesValue) i++
  } else positional.push(args[i])
}
for (const f of flagDefs) if (f.required && !args.includes(f.name)) fail(1, `Falta la bandera ${f.name} de ${cmd}`)
const required = def.args.filter((a) => a.required).length
if (positional.length < required) fail(1, `Faltan argumentos para ${cmd}: se esperaban ${required}, hay ${positional.length}`)
if (!def.args.some((a) => a.variadic) && positional.length > def.args.length) fail(1, `Sobran argumentos para ${cmd}`)

// ── parada: STOP/EOF por stdin (Windows) o SIGTERM (macOS) ──
function stop(event) {
  log({ event, cmd })
  process.exit(3)
}
process.on('SIGTERM', () => stop('sigterm'))
if (platform === 'win32') {
  let buf = ''
  process.stdin.setEncoding('utf8')
  process.stdin.on('data', (d) => {
    buf += d
    if (/^STOP\s*$/m.test(buf)) stop('stop')
  })
  process.stdin.on('end', () => stop('stop'))
}

let responses = {}
if (scriptFile) responses = JSON.parse(readFileSync(scriptFile, 'utf8')).responses ?? {}
// Una lista de respuestas se consume una por LLAMADA (cada llamada es un proceso nuevo: el contador vive en un archivo).
const pick = (name) => {
  const r = responses[name]
  if (!Array.isArray(r)) return r ?? DEFAULTS[name] ?? { out: { ok: true } }
  const stateFile = scriptFile + '.state'
  let state = {}
  try {
    state = JSON.parse(readFileSync(stateFile, 'utf8'))
  } catch {
    // primera llamada
  }
  const n = state[name] ?? 0
  state[name] = n + 1
  writeFileSync(stateFile, JSON.stringify(state))
  return r[Math.min(n, r.length - 1)]
}

function respond(r) {
  if (r.writeImage) {
    const out =
      (def.args.findIndex((a) => a.name === 'outPath' || a.name === 'out') >= 0
        ? positional[def.args.findIndex((a) => a.name === 'outPath' || a.name === 'out')]
        : undefined) ?? positional.find((p) => /\.(png|jpe?g)$/i.test(p))
    if (out) {
      // `imageB64`: imagen propia de ESTA llamada (con una lista de respuestas, sondas «antes» y «después» distintas).
      if (r.imageB64) writeFileSync(out, Buffer.from(r.imageB64, 'base64'))
      else if (process.env.FAKE_CU_IMAGE) copyFileSync(process.env.FAKE_CU_IMAGE, out)
      else writeFileSync(out, Buffer.from(TINY_JPEG_B64, 'base64'))
    }
    // `--probe <ruta>` (window-shot de Windows): escribe también la miniatura; `probeB64` la fija, y si no, la misma imagen.
    const pi = args.findIndex((a) => a === '--probe' || a.startsWith('--probe='))
    if (pi >= 0 && platform === 'win32') {
      const pOut = args[pi].startsWith('--probe=') ? args[pi].slice('--probe='.length) : args[pi + 1]
      if (pOut) writeFileSync(pOut, Buffer.from(r.probeB64 ?? r.imageB64 ?? TINY_JPEG_B64, 'base64'))
    }
  }
  if (r.exit) fail(r.exit, r.stderr ?? `error simulado (${r.exit})`)
  if (r.pad) process.stdout.write('x'.repeat(r.pad))
  else if (r.raw !== undefined) process.stdout.write(String(r.raw))
  else process.stdout.write(JSON.stringify(r.out ?? { ok: true }) + '\n')
  process.stdout.write('', () => process.exit(0))
}

const r = pick(cmd)
if (r.sleepMs) setTimeout(() => respond(r.then ?? { out: { ok: true } }), r.sleepMs)
else respond(r)
