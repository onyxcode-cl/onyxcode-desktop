// Biblioteca PURA de la bateria de ataques de Tareas en Windows (sin red, sin Electron; solo `node:*`). La usa
// `attack-tool.mjs` (que corre en el PC con `tasks-attack.ps1`) y la prueba de macOS `src/main/tasks/win-attack-suite.test.ts`.
//
// Contiene: el codificador del paquete LZPK1 (misma logica que src/main/tasks/backends/wsl-payload.ts; la prueba exige que
// den los mismos bytes), el shim `bin/opencode` que corre la suite, la trama del puente (misma que bridge-protocol.ts y
// resources/wsl/protocol.py), la construccion de la trama INIT y de la configuracion de la suite, las comprobaciones de
// «fuera» y el ensamblado del informe `tasks-win-report` (esquema 1). Todo falla CERRADO: lo que no se midio no es `pass`.
import { createHash } from 'node:crypto'
import { gzipSync } from 'node:zlib'

export const REPORT_SCHEMA = 1
export const SUITE_VERSION = 1
export const DISTRO = 'Lazunox-Attack'
export const LAUNCHER = '/opt/lazunox/launcher.py'
export const INSTALLER = '/usr/local/sbin/lazunox-install'

/** Ataques que cada sesion debe cubrir (igual que REQUIRED_ATTACK_IDS de tasks-win-report.ts; lo vigila la prueba). */
export const REQUIRED_ATTACK_IDS = [
  'A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A6b', 'A7', 'A7b', 'A8', 'A9', 'A10', 'A11', 'A12', 'A13', 'A14', 'A15', 'A16', 'A17', 'A18', 'A19', 'A20'
]

/** Igual que ISOLATION_FILES de tasks-win-report.ts (lo vigila la prueba). */
export const ISOLATION_FILES = [
  'src/main/tasks/backends/wsl-spec.ts',
  'src/main/tasks/backends/wsl-paths.ts',
  'src/main/tasks/backends/wsl.ts',
  'src/main/tasks/backends/wsl-bridge-host.ts',
  'src/main/tasks/backends/bridge-protocol.ts',
  'src/main/tasks/ui-path.ts',
  'src/main/tasks/folder-policy.ts',
  'src/main/tasks/folder-policy-win.ts',
  'src/main/tasks/win-drives.ts',
  'src/main/tasks/sandbox.ts',
  'src/main/tasks/proxy.ts',
  'src/main/tasks/proxy-policy.ts',
  'src/main/tasks/provider-egress.ts',
  'src/shared/wsl-paths.ts',
  'src/shared/tasks-path-map.ts',
  'resources/wsl/launcher.py',
  'resources/wsl/landlock.py',
  'resources/wsl/mux.py',
  'resources/wsl/protocol.py',
  'resources/wsl/wsl.conf'
]

export const sha256Hex = (b) => createHash('sha256').update(b).digest('hex')
/** sha256 del contenido con CRLF -> LF (igual que la guardia: un checkout de Windows con autocrlf no invalida el informe). */
export const sha256Normalized = (buf) => sha256Hex(Buffer.from(Buffer.from(buf).toString('latin1').replace(/\r\n/g, '\n'), 'latin1'))
const toLf = (buf) => Buffer.from(Buffer.from(buf).toString('latin1').replace(/\r\n/g, '\n'), 'latin1')

// ───────────────────────── Paquete LZPK1 ─────────────────────────

const LZPK_MAGIC = 'LZPK1\n'
const LZPK_PATH_RE = /^(?:[a-z0-9_-]+\.py|bin\/opencode)$/
const LZPK_MAX_FILES = 16
const LZPK_MAX_TOTAL = 512 * 1024 * 1024
const LZPK_MAX_MANIFEST = 64 * 1024

/** Mismo formato y orden de claves que `encodeLzpk` de wsl-payload.ts. `files`: [{path, data}]. */
export function encodeLzpk(files) {
  if (files.length > LZPK_MAX_FILES) throw new Error('demasiados archivos')
  const seen = new Set()
  let total = 0
  const entries = []
  for (const f of files) {
    if (!LZPK_PATH_RE.test(f.path)) throw new Error(`ruta no permitida: ${f.path}`)
    if (seen.has(f.path)) throw new Error(`ruta duplicada: ${f.path}`)
    seen.add(f.path)
    if (f.data.byteLength === 0) throw new Error(`archivo vacio: ${f.path}`)
    total += f.data.byteLength
    if (total > LZPK_MAX_TOTAL) throw new Error('carga demasiado grande')
    entries.push({
      path: f.path,
      size: f.data.byteLength,
      sha256: sha256Hex(f.data),
      mode: f.path === 'launcher.py' || f.path === 'bin/opencode' ? 0o755 : 0o644,
      kind: f.path === 'bin/opencode' ? 'opencode-tgz' : 'file'
    })
  }
  for (const req of ['launcher.py', 'bin/opencode']) if (!seen.has(req)) throw new Error(`falta ${req}`)
  entries.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
  const mBytes = Buffer.from(JSON.stringify({ v: 1, files: entries.map((f) => ({ path: f.path, size: f.size, sha256: f.sha256, mode: f.mode, kind: f.kind })) }), 'utf8')
  if (mBytes.length > LZPK_MAX_MANIFEST) throw new Error('manifiesto demasiado grande')
  const len = Buffer.alloc(4)
  len.writeUInt32BE(mBytes.length, 0)
  const byPath = new Map(files.map((f) => [f.path, f.data]))
  return {
    buffer: Buffer.concat([Buffer.from(LZPK_MAGIC, 'latin1'), len, mBytes, ...entries.map((f) => Buffer.from(byPath.get(f.path)))]),
    manifest: { v: 1, files: entries },
    payloadSha: sha256Hex(mBytes)
  }
}

/** `.tar.gz` con UN miembro regular (`name`), como exige `extract_opencode` de lazunox-install. Determinista. */
export function makeSingleFileTgz(name, data, mode = 0o755) {
  const oct = (n, w) => n.toString(8).padStart(w - 1, '0') + '\0'
  const h = Buffer.alloc(512)
  h.write(name, 0, 'latin1')
  h.write(oct(mode, 8), 100, 'latin1')
  h.write(oct(0, 8), 108, 'latin1')
  h.write(oct(0, 8), 116, 'latin1')
  h.write(oct(data.length, 12), 124, 'latin1')
  h.write(oct(0, 12), 136, 'latin1')
  h.write('        ', 148, 'latin1')
  h.write('0', 156, 'latin1')
  h.write('ustar\0', 257, 'latin1')
  h.write('00', 263, 'latin1')
  let sum = 0
  for (const b of h) sum += b
  h.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 'latin1')
  const pad = (512 - (data.length % 512)) % 512
  return gzipSync(Buffer.concat([h, data, Buffer.alloc(pad), Buffer.alloc(1024)]), { level: 9 })
}

/** El `bin/opencode` de la distro de PRUEBA: un shim que entrega el control a la suite (corre como `lazunox`, bajo Landlock). */
export const STUB_OPENCODE = `#!/usr/bin/python3
import sys
sys.dont_write_bytecode = True
sys.path.insert(0, "/opt/lazunox")
import attack_suite
attack_suite.serve(sys.argv[1:])
`

/**
 * Paquete de la distro de prueba: los 4 .py REALES del aislamiento + la suite + el shim. \`sources\` = { launcher, landlock, mux,
 * protocol, suite } (Buffer). Los .py se normalizan a LF (un shebang con CRLF no arrancaria).
 */
export function buildAttackPayload(sources) {
  const files = [
    { path: 'launcher.py', data: toLf(sources.launcher) },
    { path: 'landlock.py', data: toLf(sources.landlock) },
    { path: 'mux.py', data: toLf(sources.mux) },
    { path: 'protocol.py', data: toLf(sources.protocol) },
    { path: 'attack_suite.py', data: toLf(sources.suite) },
    { path: 'bin/opencode', data: makeSingleFileTgz('opencode', Buffer.from(STUB_OPENCODE, 'utf8')) }
  ]
  return encodeLzpk(files)
}

// ───────────────────────── Trama del puente (bridge-protocol.ts / protocol.py) ─────────────────────────

export const FrameType = { INIT: 1, OPEN: 2, DATA: 3, CLOSE: 4, ERROR: 5, WINDOW: 6, PING: 7, PONG: 8, READY: 9, EXIT: 10 }
export const MAX_FRAME_DATA = 1024 * 1024
export const MAX_INIT_BYTES = 64 * 1024

export function encodeFrame(id, type, data = Buffer.alloc(0)) {
  if (!Number.isInteger(id) || id < 0 || id > 0xffffffff) throw new Error('id invalido')
  if (!Object.values(FrameType).includes(type)) throw new Error('tipo invalido')
  if (data.length > MAX_FRAME_DATA) throw new Error('trama demasiado grande')
  const h = Buffer.alloc(9)
  h.writeUInt32BE(id, 0)
  h.writeUInt8(type, 4)
  h.writeUInt32BE(data.length, 5)
  return Buffer.concat([h, data])
}

export class FrameDecoder {
  constructor() {
    this.buf = Buffer.alloc(0)
  }
  /** Devuelve las tramas completas; ante un tipo o tamano invalido lanza (la sesion se corta). */
  push(chunk) {
    this.buf = Buffer.concat([this.buf, chunk])
    const out = []
    while (this.buf.length >= 9) {
      const id = this.buf.readUInt32BE(0)
      const type = this.buf.readUInt8(4)
      const n = this.buf.readUInt32BE(5)
      if (!Object.values(FrameType).includes(type)) throw new Error('bad_type')
      if (n > MAX_FRAME_DATA) throw new Error('frame_too_large')
      if (this.buf.length < 9 + n) break
      out.push({ id, type, data: Buffer.from(this.buf.subarray(9, 9 + n)) })
      this.buf = this.buf.subarray(9 + n)
    }
    return out
  }
}

export const encodePort = (p) => {
  const b = Buffer.alloc(2)
  b.writeUInt16BE(p, 0)
  return b
}
export const encodeWindow = (n) => {
  const b = Buffer.alloc(4)
  b.writeUInt32BE(n, 0)
  return b
}

// ───────────────────────── Rutas, carpetas y trama INIT ─────────────────────────

const SEGMENT_OK = (s) =>
  s.length > 0 &&
  s !== '.' &&
  s !== '..' &&
  s.length <= 255 &&
  !/[\u0000-\u001f\u007f:<>"|?*\\]/.test(s) &&
  !/[. ]$/.test(s) &&
  !/^(?:con|prn|aux|nul|conin\$|conout\$|clock\$|com[0-9]|lpt[0-9])$/i.test(s.split('.')[0].replace(/ +$/, '')) &&
  !/~[0-9]/.test(s)

/** `C:\onyx\attack\r1\a` -> `/win/c/onyx/attack/r1/a` (traduccion lexica; NO autoriza nada). */
export function toLinuxPath(win) {
  const m = /^([A-Za-z]):\\(.*)$/.exec(win)
  if (!m) throw new Error(`ruta de Windows invalida: ${win}`)
  const segs = m[2].split('\\').filter((s) => s !== '')
  for (const s of segs) if (!SEGMENT_OK(s)) throw new Error(`segmento no valido: ${s}`)
  return ['/win', m[1].toLowerCase(), ...segs].join('/')
}

export const FOLDER_NAMES = { main: 'a', rw2: 'rw2', ro: 'ro', cfg: 'cfg', victim: 'victima' }
export const LINK_NAMES = { junction: 'j', symDir: 's', symFile: 'f.txt', hard: 'h.txt', evil: 'evil.exe' }

/** Carpetas de UNA ejecucion: todas bajo `<root>\attack\<run>`. */
export function layoutFor(root, run) {
  if (!/^[A-Za-z]:\\[^\\].*$/.test(root) || /\\$/.test(root)) throw new Error('root invalido')
  if (!/^[a-z][0-9a-f]{8}$/.test(run)) throw new Error('nombre de ejecucion invalido')
  const base = `${root}\\attack\\${run}`
  const win = { base }
  const linux = { base: toLinuxPath(base) }
  for (const [k, v] of Object.entries(FOLDER_NAMES)) {
    win[k] = `${base}\\${v}`
    linux[k] = toLinuxPath(win[k])
  }
  win.scratch = `${win.main}\\.lazunox\\trabajo`
  linux.scratch = toLinuxPath(win.scratch)
  return { win, linux }
}

const SYSTEM_RULES = [
  ['/usr', 'rx'], ['/lib', 'rx'], ['/lib64', 'rx'], ['/bin', 'rx'], ['/sbin', 'rx'], ['/etc', 'ro'], ['/opt/lazunox', 'rx'], ['/proc', 'ro'], ['/dev', 'dev']
]

/** Trama INIT con la MISMA forma que `buildWslInit`: principal rw, un rw adicional, un ro y la config ro; scratch dentro. */
export function buildInit({ layout, sandboxKey, serverPort, relayPorts, allowDelete, placeholder }) {
  if (!/^[0-9a-f]{16}$/.test(sandboxKey)) throw new Error('sandboxKey')
  if (!/^sandboxed-placeholder-[0-9a-f]{16}$/.test(placeholder)) throw new Error('centinela')
  const mounts = [
    { win: layout.win.main, linux: layout.linux.main, mode: 'rw' },
    { win: layout.win.rw2, linux: layout.linux.rw2, mode: 'rw' },
    { win: layout.win.ro, linux: layout.linux.ro, mode: 'ro' },
    { win: layout.win.cfg, linux: layout.linux.cfg, mode: 'ro' }
  ]
  const rules = [
    ...SYSTEM_RULES.map(([path, access]) => ({ path, access })),
    { path: `/home/lazunox/xdg/${sandboxKey}`, access: 'private' },
    { path: `/tmp/lazunox-${sandboxKey}`, access: 'private' }
  ]
  mounts.forEach((m, i) => rules.push({ path: m.linux, access: m.mode === 'ro' ? 'ro' : i === 0 && allowDelete ? 'rw-delete' : 'rw-nodelete' }))
  rules.push({ path: layout.linux.scratch, access: 'rw-delete' })
  const init = {
    v: 1,
    sandboxKey,
    mounts,
    relayPorts: [...new Set(relayPorts)].sort((a, b) => a - b),
    serverPort,
    serveArgs: ['serve', '--port', String(serverPort), '--hostname', '127.0.0.1'],
    cwd: layout.linux.main,
    env: {
      OPENCODE_AUTH_CONTENT: JSON.stringify({ opencode: { type: 'api', key: placeholder } }),
      LAZUNOX_TASKS_FOLDER: layout.linux.main,
      OPENCODE_CONFIG_DIR: layout.linux.cfg
    },
    landlock: { minAbi: 2, rules }
  }
  const bytes = Buffer.from(JSON.stringify(init), 'utf8')
  if (bytes.length > MAX_INIT_BYTES) throw new Error('INIT demasiado grande')
  return { init, frame: encodeFrame(0, FrameType.INIT, bytes) }
}

/** Configuracion que recibe la suite por el flujo (validate_cfg de attack_suite.py la valida). */
export function buildSuiteConfig({ layout, runId, session, token, allowDelete, prep, payloadSha, serverPort, relayPorts, attackTimeoutSec, totalTimeoutSec, only }) {
  const links = {}
  const note = (k) => (typeof prep[`${k}Note`] === 'string' && prep[`${k}Note`] ? prep[`${k}Note`] : 'no se creo')
  for (const [k, name] of [['junction', LINK_NAMES.junction], ['symDir', LINK_NAMES.symDir], ['symFile', LINK_NAMES.symFile], ['hard', LINK_NAMES.hard]]) {
    if (prep[k] === true) links[k] = name
    else links[`${k}Note`] = note(k)
  }
  links.symNote = [prep.symDirNote, prep.symFileNote].filter(Boolean).join(' | ') || 'no se creo'
  links.junctionNote = note('junction')
  links.hardNote = note('hard')
  const mounts = [
    { linux: layout.linux.main, mode: 'rw' },
    { linux: layout.linux.rw2, mode: 'rw' },
    { linux: layout.linux.ro, mode: 'ro' },
    { linux: layout.linux.cfg, mode: 'ro' }
  ]
  return {
    v: SUITE_VERSION,
    runId,
    session,
    main: layout.linux.main,
    victim: layout.linux.victim,
    victimToken: token,
    work: `${layout.linux.main}/.lzx-attack-${runId}`,
    scratch: layout.linux.scratch,
    allowDelete,
    mounts,
    unmounted: [layout.linux.victim, `${layout.linux.base}/sombra`],
    links,
    evil: prep.evil === true ? LINK_NAMES.evil : null,
    payloadSha,
    serverPort,
    relayPorts,
    attackTimeoutSec,
    totalTimeoutSec,
    only
  }
}

// ───────────────────────── Salida de la suite y comprobaciones de «fuera» ─────────────────────────

/** Una linea JSON por resultado. Lo que no parsee se descarta (y se cuenta): un id sin fila luego cuenta como fallo. */
export function parseResultLines(text) {
  const results = []
  let done = null
  let error = null
  let bad = 0
  for (const line of String(text).split('\n')) {
    if (!line.trim()) continue
    let o
    try {
      o = JSON.parse(line)
    } catch {
      bad++
      continue
    }
    if (o && o.type === 'result') results.push(o)
    else if (o && o.type === 'done') done = o
    else if (o && o.type === 'error') error = String(o.message ?? 'error')
    else bad++
  }
  return { results, done, error, bad }
}

/** Mismo analisis de /proc/self/mountinfo que attack_suite.parse_mountinfo. */
export function parseMountinfo(text) {
  const out = []
  for (const line of String(text).split('\n')) {
    const i = line.indexOf(' - ')
    if (i < 0) continue
    const f = line.slice(0, i).split(' ')
    const t = line.slice(i + 3).split(' ')
    if (f.length < 6 || t.length < 3) continue
    const un = (s) => s.replace(/\\([0-7]{3})/g, (_, o) => String.fromCharCode(parseInt(o, 8)))
    out.push({ mnt: un(f[4]), opts: f[5].split(','), fstype: t[0], source: un(t[1]) })
  }
  return out
}

/** Vista desde FUERA (espacio de nombres raiz de la distro): no debe haber ninguna unidad de Windows montada. */
export function outsideMountProblems(mountinfoText) {
  const bad = []
  for (const m of parseMountinfo(mountinfoText)) {
    const net = ['9p', 'drvfs', 'virtiofs'].includes(m.fstype) || m.fstype.startsWith('fuse')
    const drive = /^[A-Za-z]:\\?/.test(m.source) || m.source === 'drvfs'
    if ((net && drive) || m.mnt.startsWith('/win/') || /^\/mnt\/[a-z](\/|$)/.test(m.mnt)) bad.push(`${m.mnt}(${m.fstype})`)
  }
  return bad
}

/** Script de Python que se envia por stdin (`python3 -`) para mirar la distro desde fuera: sin comillas que escapar. */
export const OUTSIDE_PROBE_PY = `import os
print("@@MOUNTINFO")
print(open("/proc/self/mountinfo").read())
print("@@PS")
for p in sorted((x for x in os.listdir("/proc") if x.isdigit()), key=int):
    try:
        cmd = open("/proc/%s/cmdline" % p, "rb").read().replace(b"\\0", b" ").decode("utf-8", "replace").strip()
    except OSError:
        continue
    print(p, cmd[:200])
print("@@END")
`

export function splitOutsideProbe(text) {
  const t = String(text).replace(/\r/g, '')
  const m = /@@MOUNTINFO\n([\s\S]*?)\n@@PS\n([\s\S]*?)@@END/.exec(t)
  return m ? { mountinfo: m[1], ps: m[2].split('\n').filter(Boolean) } : null
}

/** Procesos del servidor/launcher que quedan en la distro (para A17). `ps` = lineas "pid cmdline". */
export function lingeringProcesses(psLines) {
  return psLines.filter((l) => /(?:^|[\s/])(?:opencode|launcher\.py|attack_suite)/.test(l) && !/@@/.test(l))
}

// ───────────────────────── Informe (esquema 1 de tasks-win-report.ts) ─────────────────────────

const arr = (x) => (Array.isArray(x) ? x : x === null || x === undefined || x === '' ? [] : [x])
const INFRA_PROCS = /^(?:wsl|wslhost|wslservice|wslrelay|vmmem\w*|vmcompute)(?:\.exe)?$/i

/** Procesos nuevos que no son infraestructura de WSL (lo que haya dejado la bateria). Entradas: "nombre|ruta". */
export function newProcesses(before, after) {
  const b = new Set(arr(before))
  return arr(after).filter((p) => !b.has(p) && !INFRA_PROCS.test(String(p).split('|')[0]))
}

function downgrade(rows, id, why) {
  for (const r of rows) {
    if (r.id === id && r.status !== 'fail') {
      r.status = 'fail'
      r.skipReason = ''
      r.evidence = `${why} | ${r.evidence}`.slice(0, 400)
    }
  }
}

/**
 * Ensambla el informe de UNA sesion. Reglas: las comprobaciones de fuera solo pueden BAJAR un resultado (nunca subirlo,
 * salvo A17 que se mide solo fuera); lo no medido (`null`) baja a fail; un id sin fila es fail; ids de mas se descartan.
 * facts = lo que mide tasks-attack.ps1 (ver docs/WINDOWS-TAREAS.md). Devuelve { report, notes }.
 */
export function assembleReport({ facts, runs, hashes, pin }) {
  const f = facts
  const notes = []
  let rows = []
  runs.forEach((run, idx) => {
    const wanted = idx === 0 ? REQUIRED_ATTACK_IDS : arr(run.only)
    const got = new Set()
    for (const raw of arr(run.results)) {
      const r = {
        id: String(raw.id),
        case: String(raw.case) + (run.allowDelete ? ' [allowDelete=true]' : ''),
        criterion: raw.criterion === 'I' ? 'I' : 'B',
        status: ['pass', 'fail', 'skip', 'blocked'].includes(raw.status) ? raw.status : 'fail',
        evidence: String(raw.evidence ?? '').slice(0, 400),
        skipReason: String(raw.skipReason ?? '').slice(0, 400),
        durationMs: Number.isFinite(raw.durationMs) && raw.durationMs >= 0 ? Math.round(raw.durationMs) : 0
      }
      if (!/^A\d{1,2}b?$/.test(r.id)) continue
      got.add(r.id)
      rows.push(r)
    }
    for (const id of wanted) {
      if (!got.has(id)) {
        notes.push(`${id}: sin fila de la suite (${run.error || 'sin motivo'})`)
        rows.push({ id, case: `sin resultado de la suite${run.allowDelete ? ' [allowDelete=true]' : ''}`, criterion: 'B', status: 'fail', evidence: `la suite no devolvio ${id}: ${run.error || 'terminacion anomala'}`.slice(0, 400), skipReason: '', durationMs: 0 })
      }
    }
  })

  // ── comprobaciones de fuera: solo bajan ──
  const need = (cond, id, why) => {
    if (cond) downgrade(rows, id, why)
  }
  const first = runs[0] ?? {}
  const smbMeasured = Number.isFinite(f.smbBefore) && Number.isFinite(f.smbAfter)
  need(!smbMeasured, 'A5', 'SMB no medido')
  need(smbMeasured && f.smbAfter - f.smbBefore > 0, 'A5', `${f.smbAfter - f.smbBefore} conexiones SMB nuevas`)
  need(!Array.isArray(f.adsStreams), 'A6', 'ADS no medido desde Windows')
  need(Array.isArray(f.adsStreams) && f.adsStreams.length > 0, 'A6', `Windows ve flujos alternos: ${f.adsStreams}`)
  const outside = first.outside
  need(!outside || typeof outside.mountinfo !== 'string', 'A7', 'no se pudo mirar la distro desde fuera')
  if (outside && typeof outside.mountinfo === 'string') {
    const p = outsideMountProblems(outside.mountinfo)
    need(p.length > 0, 'A7', `fuera se ven unidades de Windows montadas: ${p.slice(0, 4)}`)
  }
  need(f.evilRunning === null || f.evilRunning === undefined, 'A8', 'procesos de Windows no medidos')
  need(f.evilRunning === true, 'A8', 'evil.exe esta en marcha en Windows')
  const nw = arr(f.newWinProcs)
  need(nw.length > 0, 'A8', `procesos nuevos de Windows: ${nw.slice(0, 4)}`)
  need(f.payloadShaAfter == null || f.wslConfBefore == null || f.wslConfAfter == null, 'A15', 'integridad de /opt/lazunox y wsl.conf no medida')
  need(f.payloadShaAfter != null && f.payloadShaAfter !== f.payloadSha, 'A15', 'payloadSha cambio')
  need(f.wslConfBefore != null && f.wslConfAfter != null && f.wslConfBefore !== f.wslConfAfter, 'A15', 'wsl.conf cambio')
  need(f.caseInfo == null, 'A16', 'fsutil queryCaseSensitiveInfo no medido')
  need(f.caseInfo != null && !/disabled/i.test(String(f.caseInfo)), 'A16', `Windows ve la carpeta sensible a mayusculas: ${f.caseInfo}`)
  const probe = f.probe
  need(!probe || typeof probe !== 'object', 'A20', '--probe no medido')
  if (probe && typeof probe === 'object') {
    need(probe.interop !== false, 'A20', 'el interop esta activo')
    need(arr(probe.driveMounts).length > 0, 'A20', `unidades montadas: ${arr(probe.driveMounts)}`)
    need(!(probe.landlockAbi >= 2), 'A20', `Landlock ABI ${probe.landlockAbi}`)
  }
  need(!/landlock/.test(String(f.lsm ?? '')), 'A20', 'landlock no aparece en /sys/kernel/security/lsm')
  need(!String(f.wslVersion ?? '').trim(), 'A20', 'version de WSL no medida')

  // A17: se mide solo fuera; sustituye la fila `skip` de la suite.
  if (f.a17 && typeof f.a17 === 'object') {
    const a = f.a17
    const left = arr(a.procsLeft)
    const ok = a.stopClean === true && a.killClean === true && Number(a.killExitSec) <= 5 && a.terminatedStopped === true && a.procsLeft != null && left.length === 0
    rows = rows.filter((r) => r.id !== 'A17')
    rows.push({
      id: 'A17',
      case: 'ciclo de vida: Detener, matar al anfitrion, distro Stopped tras --terminate, sin procesos colgando',
      criterion: 'B',
      status: ok ? 'pass' : 'fail',
      evidence: `detener limpio=${a.stopClean}; matar anfitrion: salida en ${a.killExitSec}s limpio=${a.killClean}; Stopped tras terminate=${a.terminatedStopped}; procesos colgando=${left.length}; reposo de Vmmem: ${a.vmmemNote ?? 'no medido'} (vmIdleTimeout no se espera: residuo)`.slice(0, 400),
      skipReason: '',
      durationMs: Math.round(Number(a.durationMs) || 0)
    })
  }

  // A6b (informativo): lo que no se pueda borrar pasa a bloquear.
  const residue = arr(f.a6bResidue)
  for (const r of rows) {
    if (r.id === 'A6b' && residue.length > 0) {
      r.criterion = 'B'
      r.status = 'fail'
      r.evidence = `quedan sin poder borrar: ${residue.slice(0, 5)} | ${r.evidence}`.slice(0, 400)
    }
  }

  const victimBefore = f.victimHashBefore
  const victimAfter = f.victimHashAfter
  const victimOk = typeof victimBefore === 'string' && victimBefore.length === 64 && victimBefore === victimAfter
  const smbNew = smbMeasured ? Math.max(0, f.smbAfter - f.smbBefore) : 1
  const newProcs = newProcesses(f.processesBefore, f.processesAfter)
  const sessionOk = (f.session === 'elevated' && f.integrity === 'high') || (f.session === 'normal' && f.integrity === 'medium')
  const baseline = {
    processesBefore: arr(f.processesBefore).map(String),
    processesAfter: arr(f.processesAfter).map(String),
    otherDistrosUnchanged: f.otherDistrosUnchanged === true,
    victimHashUnchanged: victimOk,
    smbNew
  }
  const dirty = !baseline.otherDistrosUnchanged || newProcs.length > 0 || f.cleanupOk !== true || smbNew > 0
  const b = rows.filter((r) => r.criterion === 'B')
  const blocking = b.filter((r) => !(r.status === 'pass' || (r.status === 'skip' && r.id === 'A3' && r.skipReason.trim())))
  const a3pass = rows.some((r) => r.id === 'A3' && r.criterion === 'B' && r.status === 'pass')
  const status = dirty ? 'dirty' : !victimOk || !sessionOk || blocking.length > 0 ? 'red' : 'green'
  if (dirty) notes.push(`dirty: distros ${baseline.otherDistrosUnchanged ? 'iguales' : 'CAMBIARON'}, procesos nuevos ${newProcs.length}, limpieza ${f.cleanupOk === true ? 'ok' : 'INCOMPLETA'}, SMB nuevas ${smbNew}`)
  if (!victimOk) notes.push('la victima cambio o no se midio')
  if (!sessionOk) notes.push(`la sesion ${f.session} no coincide con la integridad ${f.integrity}: el informe NO vale`)
  if (!a3pass) notes.push('A3 no dio pass en esta sesion (debe darlo en al menos una de las dos)')

  const summary = {}
  for (const r of rows) {
    const s = (summary[r.criterion] ??= {})
    s[r.status] = (s[r.status] ?? 0) + 1
  }
  const report = {
    schema: REPORT_SCHEMA,
    generatedAt: f.generatedAt,
    session: f.session,
    integrity: f.integrity,
    host: {
      windows: String(f.windows ?? ''),
      wslVersion: String(f.wslVersion ?? ''),
      kernel: String(probe?.kernel ?? ''),
      landlockAbi: Number.isInteger(probe?.landlockAbi) && probe.landlockAbi >= 0 ? probe.landlockAbi : 0
    },
    build: {
      gitSha: String(f.gitSha ?? 'unknown'),
      rootfsSha: String(f.rootfsSha ?? ''),
      payloadSha: String(f.payloadSha ?? ''),
      opencodeVersion: String(pin?.version ?? ''),
      hashes
    },
    results: rows.map(({ id, case: c, criterion, status: s, evidence, skipReason, durationMs }) => ({ id, case: c, criterion, status: s, evidence, skipReason, durationMs })),
    baseline,
    status,
    summary
  }
  return { report, notes, blocking: blocking.map((r) => `${r.id} [${r.status}] ${r.status === 'skip' ? r.skipReason : r.evidence}`.slice(0, 240)) }
}

/** Resumen legible (texto plano ASCII-friendly) del informe y de lo que lo bloquea. */
export function summarizeReport(report, notes, blocking) {
  const L = []
  L.push(`TASKS-ATTACK ${report.generatedAt} sesion=${report.session} integridad=${report.integrity} estado=${report.status.toUpperCase()}`)
  L.push(`host: Windows ${report.host.windows} | WSL ${report.host.wslVersion} | nucleo ${report.host.kernel} | Landlock ABI ${report.host.landlockAbi}`)
  L.push(`build: git ${report.build.gitSha} | rootfs ${report.build.rootfsSha.slice(0, 12)} | payload ${report.build.payloadSha.slice(0, 12)} | OpenCode ${report.build.opencodeVersion}`)
  L.push('')
  for (const r of report.results) {
    L.push(`${r.status.toUpperCase().padEnd(7)}${r.criterion} ${r.id.padEnd(4)} ${r.case.slice(0, 70)}`)
    if (r.status !== 'pass') L.push(`        ${(r.status === 'skip' ? r.skipReason : r.evidence).slice(0, 160)}`)
  }
  L.push('')
  L.push(`resumen: ${JSON.stringify(report.summary)}`)
  if (blocking.length) {
    L.push('BLOQUEAN la activacion:')
    for (const b of blocking) L.push(`  - ${b}`)
  }
  for (const n of notes) L.push(`nota: ${n}`)
  L.push('Este informe NO enciende nada: la guardia exige las DOS sesiones (elevada y normal), hashes al dia y todos los B en pass.')
  return L.join('\n') + '\n'
}
