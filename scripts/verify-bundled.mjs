#!/usr/bin/env node
// Verificación del .dmg/.app EMPAQUETADO con el OpenCode oficial embebido (tanda C). Se ejecuta
// DESPUÉS de `npm run package` (no forma parte de `npm run verify`, que no empaqueta):
//   npm run verify:bundled [-- --app <ruta.app>] [-- --dmg <ruta.dmg>]
// Comprobaciones: firma del .app (codesign --verify --deep --strict), `--version` del binario embebido
// == pin.version, el binario sirve /global/health DENTRO del perfil Seatbelt real de Tareas
// (buildSandboxProfile) con HOME/XDG temporales, .dmg < 200 MB, y avisos/licencias de Electron.
// Nunca usa el HOME ni los XDG reales. Informa el sha256 del binario antes (descargado) y después
// (dentro del .app, ya vuelto a firmar por electron-builder).
import { spawn, spawnSync } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const pin = JSON.parse(readFileSync(join(root, 'resources/opencode-bin/pin.json'), 'utf8'))
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const argv = process.argv.slice(2)
const arg = (name) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : undefined)
const appPath = resolve(arg('--app') ?? join(root, 'dist/mac-arm64/OnyxCode.app'))
const dmgPath = resolve(arg('--dmg') ?? join(root, 'dist', `${pkg.name}-${pkg.version}-arm64.dmg`))
const res = join(appPath, 'Contents/Resources')
const bin = join(res, 'opencode/opencode')
const DMG_LIMIT = 200 * 1024 * 1024

const results = []
const record = (name, ok, detail) => {
  results.push({ name, ok })
  console.log(`${ok ? 'OK   ' : 'FALLA'} ${name}${detail ? ` — ${detail}` : ''}`)
}
const sha256 = (p) => createHash('sha256').update(readFileSync(p)).digest('hex')
const run = (cmd, args, opts = {}) => spawnSync(cmd, args, { encoding: 'utf8', ...opts })
const sigInfo = (p) => {
  const r = run('codesign', ['-dv', '--verbose=2', p])
  const out = `${r.stdout}${r.stderr}`
  const id = /^Identifier=(.*)$/m.exec(out)?.[1]
  const sig = /^Signature=(.*)$/m.exec(out)?.[1] ?? (/flags=.*\(adhoc/.test(out) ? 'adhoc' : '?')
  return `Identifier=${id} Signature=${sig}`
}
const freePort = () =>
  new Promise((ok, ko) => {
    const s = createServer()
    s.once('error', ko)
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address()
      s.close(() => ok(port))
    })
  })

async function main() {
  if (!existsSync(appPath)) {
    console.error(`No existe ${appPath}: ejecutá antes \`npm run package\`.`)
    process.exit(1)
  }

  // 1. Firma del .app
  const cs = run('codesign', ['--verify', '--deep', '--strict', '--verbose=2', appPath])
  record('codesign --verify --deep --strict del .app', cs.status === 0, cs.status === 0 ? 'válida' : (cs.stderr || '').trim().split('\n').slice(-2).join(' | '))

  // 2. Binario embebido presente, versión == pin.version
  if (!existsSync(bin)) {
    record('binario embebido presente', false, bin)
  } else {
    const st = statSync(bin)
    record('binario embebido presente y ejecutable', (st.mode & 0o111) !== 0, `${bin} (${st.size} bytes)`)
    const v = run(bin, ['--version'], { env: { PATH: '/usr/bin:/bin', HOME: mkdtempSync(join(tmpdir(), 'vb-home-')) } })
    const got = (v.stdout || '').trim()
    record(`opencode --version == pin.version (${pin.version})`, v.status === 0 && got === pin.version, `obtenido «${got}»`)
    // sha antes/después de la firma
    const fetched = join(root, 'resources/opencode-bin/bin/opencode')
    const before = existsSync(fetched) ? sha256(fetched) : '(no descargado)'
    const after = sha256(bin)
    console.log(`INFO  binario descargado (antes de firmar): sha256 ${before}`)
    if (existsSync(fetched)) console.log(`INFO    ${sigInfo(fetched)}`)
    console.log(`INFO  binario en el .app (después de firmar): sha256 ${after}`)
    console.log(`INFO    ${sigInfo(bin)}`)
    console.log(`INFO  ${before === after ? 'sha256 IGUAL (no se volvió a firmar)' : 'sha256 DISTINTO: electron-builder volvió a firmar el Mach-O (esperado; solo cambia la firma)'}`)
    await sandboxed()
  }

  // 3. .dmg
  if (!existsSync(dmgPath)) record('.dmg presente', false, dmgPath)
  else {
    const size = statSync(dmgPath).size
    record('tamaño del .dmg < 200 MB', size < DMG_LIMIT, `${size} bytes (${(size / 1024 / 1024).toFixed(1)} MiB) ${dmgPath}`)
  }

  // 4. Avisos y licencias
  for (const f of ['THIRD_PARTY_NOTICES.md', 'licenses/electron/LICENSE', 'licenses/electron/LICENSES.chromium.html']) {
    const p = join(res, f)
    record(`presente Contents/Resources/${f}`, existsSync(p) && statSync(p).size > 0, existsSync(p) ? `${statSync(p).size} bytes` : 'falta')
  }

  const failed = results.filter((r) => !r.ok)
  if (failed.length) {
    console.error(`verify:bundled FALLÓ (${failed.length}/${results.length}): ${failed.map((r) => r.name).join('; ')}`)
    process.exit(1)
  }
  console.log(`verify:bundled OK (${results.length} controles)`)
}

/** Corre el binario embebido dentro del perfil Seatbelt REAL de Tareas, con HOME/XDG temporales. */
async function sandboxed() {
  if (process.platform !== 'darwin' || !existsSync('/usr/bin/sandbox-exec')) {
    record('binario dentro del perfil Seatbelt de Tareas', false, 'sandbox-exec no disponible')
    return
  }
  // Node 22.18+ ejecuta .ts directamente (el módulo solo importa node:* y un `import type`).
  const { buildSandboxProfile, sandboxDirs, sandboxEnv } = await import(pathToFileURL(join(root, 'src/main/tasks/sandbox-profile.ts')).href)
  const tmp = realpathSync(mkdtempSync(join(tmpdir(), 'vb-sbx-')))
  const home = join(tmp, 'home')
  const userData = join(tmp, 'userData')
  const folder = join(tmp, 'carpeta')
  const privateDir = join(userData, 'tasks-sandbox', 'abc')
  const dirs = sandboxDirs(privateDir)
  for (const d of [home, folder, dirs.config, dirs.data, dirs.cache, dirs.state, dirs.tmp]) mkdirSync(d, { recursive: true })
  writeFileSync(join(userData, 'secreto.txt'), 'secreto')
  const port = await freePort()
  const profile = join(tmp, 'perfil.sb')
  writeFileSync(profile, buildSandboxProfile({ folder, privateDir, userData, home, serverPort: port, allowedOutboundPorts: [] }))
  const user = 'tasks'
  const pass = randomBytes(12).toString('base64url')
  const env = {
    PATH: '/usr/bin:/bin',
    HOME: home,
    ...sandboxEnv(dirs),
    OPENCODE_SERVER_USERNAME: user,
    OPENCODE_SERVER_PASSWORD: pass
  }
  let tail = ''
  const child = spawn('/usr/bin/sandbox-exec', ['-f', profile, bin, 'serve', '--port', String(port), '--hostname', '127.0.0.1'], {
    cwd: folder,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true
  })
  const collect = (d) => (tail = (tail + d.toString()).slice(-2000))
  child.stdout.on('data', collect)
  child.stderr.on('data', collect)
  let exited = null
  child.once('exit', (c) => (exited = c ?? 'signal'))
  const killAll = () => {
    try {
      process.kill(-child.pid, 'SIGKILL')
    } catch {}
  }
  try {
    const auth = `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`
    let body = null
    const t0 = Date.now()
    while (Date.now() - t0 < 30_000 && exited === null && !body) {
      try {
        const r = await fetch(`http://127.0.0.1:${port}/global/health`, { headers: { authorization: auth }, signal: AbortSignal.timeout(2000) })
        if (r.ok) body = await r.json()
      } catch {}
      if (!body) await new Promise((r) => setTimeout(r, 300))
    }
    const ms = Date.now() - t0
    const ok = Boolean(body?.healthy) && body.version === pin.version
    record('binario sirve /global/health dentro del Seatbelt de Tareas', ok, body ? `healthy=${body.healthy} version=${body.version} en ${ms} ms` : `sin respuesta (exit=${exited}) ${tail.trim().slice(-300)}`)
    // El perfil sigue aislando: lectura de userData denegada dentro del sandbox.
    const deny = run('/usr/bin/sandbox-exec', ['-f', profile, '/bin/cat', join(userData, 'secreto.txt')])
    record('el perfil deniega leer userData (control negativo)', deny.status !== 0 && !(deny.stdout || '').includes('secreto'), `exit=${deny.status}`)
  } finally {
    killAll()
    await new Promise((r) => setTimeout(r, 300))
    rmSync(tmp, { recursive: true, force: true })
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
