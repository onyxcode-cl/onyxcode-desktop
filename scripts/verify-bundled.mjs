#!/usr/bin/env node
// Verificación del .dmg/.app EMPAQUETADO con el OpenCode oficial embebido (tanda C). Se ejecuta
// DESPUÉS de `npm run package` (no forma parte de `npm run verify`, que no empaqueta):
//   npm run verify:bundled [-- --app <ruta.app>] [-- --dmg <ruta.dmg>]
// Comprobaciones: firma del .app (codesign --verify --deep --strict), `--version` del binario embebido
// == pin.version, el binario sirve /global/health DENTRO del perfil Seatbelt real de Tareas
// (buildSandboxProfile) con HOME/XDG temporales, .dmg < 400 MB, herramientas internas (helper, cu-keys, Python, skills) y avisos/licencias de Electron.
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
const appPath = resolve(arg('--app') ?? join(root, 'dist/mac-arm64/Lazunox.app'))
const dmgPath = resolve(arg('--dmg') ?? join(root, 'dist', `${pkg.name}-${pkg.version}-arm64.dmg`))
const res = join(appPath, 'Contents/Resources')
// macOS: el motor es el ejecutable de la mini-app «Lazunox Motor» (identidad TCC propia, docs/DISENO-LAZUNOX-MOTOR.md).
const motorApp = join(res, 'opencode/Lazunox Motor.app')
// `--engine <ruta>`: probar OTRO ejecutable del motor (p. ej. la copia externa de ~/Library/Application Support/Lazunox Motor) con las mismas pruebas.
const bin = resolve(arg('--engine') ?? join(motorApp, 'Contents/MacOS/opencode'))
const motorId = `${pkg.build?.appId ?? /appId: '([^']*)'/.exec(readFileSync(join(root, 'electron-builder.js'), 'utf8'))?.[1]}.motor`
// Medido: ~302 MiB con OpenCode y Python incluidos; por encima de 400 MiB algo va mal (p. ej. se empaquetó dos veces).
const DMG_LIMIT = 400 * 1024 * 1024

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
  record(
    'codesign --verify --deep --strict del .app',
    cs.status === 0,
    cs.status === 0 ? 'válida' : (cs.stderr || '').trim().split('\n').slice(-2).join(' | ')
  )

  // 1b. Mini-app del motor: bundle sellado, id propio, sin binario suelto duplicado
  const mcs = run('codesign', ['--verify', '--strict', '--verbose=2', motorApp])
  record('codesign --verify --strict de Lazunox Motor.app', mcs.status === 0, mcs.status === 0 ? 'válida' : (mcs.stderr || '').trim().split('\n').slice(-2).join(' | '))
  const mInfo = run('codesign', ['-dv', '--verbose=2', motorApp])
  const mOut = `${mInfo.stdout}${mInfo.stderr}`
  record(`Identifier de Lazunox Motor.app = ${motorId}`, new RegExp(`^Identifier=${motorId.replace(/\./g, '\\.')}$`, 'm').test(mOut), /^Identifier=(.*)$/m.exec(mOut)?.[1])
  record('Lazunox Motor.app: Info.plist sellado por la firma', /Info\.plist entries=[1-9]/.test(mOut), /Info\.plist entries=\S+/.exec(mOut)?.[0])
  const plist = run('plutil', ['-extract', 'CFBundleIdentifier', 'raw', join(motorApp, 'Contents/Info.plist')])
  record('Info.plist: CFBundleIdentifier del motor', (plist.stdout || '').trim() === motorId, (plist.stdout || '').trim())
  record('no queda un opencode suelto en Resources/opencode', !existsSync(join(res, 'opencode/opencode')), join(res, 'opencode/opencode'))

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
    console.log(
      `INFO  ${before === after ? 'sha256 IGUAL (no se volvió a firmar)' : 'sha256 DISTINTO: electron-builder volvió a firmar el Mach-O (esperado; solo cambia la firma)'}`
    )
    await sandboxed()
  }

  // 3. .dmg
  if (!existsSync(dmgPath)) record('.dmg presente', false, dmgPath)
  else {
    const size = statSync(dmgPath).size
    record('tamaño del .dmg < 400 MB', size < DMG_LIMIT, `${size} bytes (${(size / 1024 / 1024).toFixed(1)} MiB) ${dmgPath}`)
  }

  // 3 bis. Script de reemplazo del actualizador: presente, ejecutable por sh y cubierto por el sello del .app.
  const swap = join(res, 'updater/swap.sh')
  record(
    'presente Contents/Resources/updater/swap.sh',
    existsSync(swap) && statSync(swap).size > 0,
    existsSync(swap) ? `${statSync(swap).size} bytes` : 'falta'
  )
  const sealFile = join(appPath, 'Contents/_CodeSignature/CodeResources')
  const sealed = existsSync(sealFile) && readFileSync(sealFile, 'utf8').includes('Resources/updater/swap.sh')
  record(
    'el sello del .app cubre Resources/updater/swap.sh',
    sealed,
    sealed ? 'listado en _CodeSignature/CodeResources' : 'no aparece en CodeResources (¿firma ad-hoc sin sellar recursos?)'
  )

  // 4. Avisos y licencias
  for (const f of ['THIRD_PARTY_NOTICES.md', 'licenses/electron/LICENSE', 'licenses/electron/LICENSES.chromium.html']) {
    const p = join(res, f)
    record(`presente Contents/Resources/${f}`, existsSync(p) && statSync(p).size > 0, existsSync(p) ? `${statSync(p).size} bytes` : 'falta')
  }

  // 5. Herramientas internas que la app usa «por detrás»: si falta alguna, el DMG instalado NO funciona igual que en desarrollo.
  for (const f of ['computer-use/bin/cu-helper', 'computer-use/bin/cu-keys']) {
    const p = join(res, f)
    const ok = existsSync(p) && (statSync(p).mode & 0o111) !== 0 && statSync(p).size > 0
    record(`herramienta interna ${f}`, ok, ok ? `${statSync(p).size} bytes` : 'falta o no es ejecutable')
  }
  const keys = join(res, 'computer-use/bin/cu-keys')
  if (existsSync(keys)) {
    const r = run(keys, ['layout'])
    record(
      'cu-keys arranca y lee el teclado activo',
      r.status === 0 && /"layout"/.test(r.stdout || ''),
      (r.stdout || r.stderr || '').trim().slice(0, 120)
    )
  }
  const py = join(res, 'python/bin/python3')
  if (existsSync(py)) {
    const r = run(py, ['-I', '-c', 'import docx, openpyxl, pptx, pypdf, pdfplumber, reportlab, pypdfium2, lxml, PIL, fitz; print("ok-libs")'])
    record(
      'Python incluido con las librerías de Word/Excel/PowerPoint/PDF',
      r.status === 0 && /ok-libs/.test(r.stdout || ''),
      (r.stdout || r.stderr || '').trim().slice(-160)
    )
  } else {
    record('Python incluido (Contents/Resources/python)', false, 'falta: ¿se ejecutó `npm run fetch:python` antes de empaquetar?')
  }
  // Dependencias completas dentro de app.asar: cada paquete de node_modules debe encontrar las suyas (la 0.5.24 salió sin is-number-object
  // —un enlace circular en node_modules confundió al empaquetador— y la app se caía al arrancar con «Cannot find module»).
  const asarFile = join(res, 'app.asar')
  if (existsSync(asarFile)) {
    try {
      const asar = (await import('@electron/asar')).default ?? (await import('@electron/asar'))
      const files = new Set(asar.listPackage(asarFile, { isPack: false }).map((f) => f.replace(/\\/g, '/')))
      const missing = []
      for (const f of files) {
        const m = /^(\/node_modules\/(?:.*\/node_modules\/)?(?:@[^/]+\/)?[^/]+)\/package\.json$/.exec(f)
        if (!m) continue
        const info = JSON.parse(asar.extractFile(asarFile, f.slice(1)).toString('utf8'))
        for (const dep of Object.keys(info.dependencies ?? {})) {
          // Resuelve como Node: sube por las carpetas node_modules desde el paquete.
          let dir = m[1]
          let found = false
          for (;;) {
            if (files.has(`${dir}/node_modules/${dep}/package.json`) || files.has(`/node_modules/${dep}/package.json`)) {
              found = true
              break
            }
            const up = dir.replace(/\/node_modules\/(?:@[^/]+\/)?[^/]+$/, '')
            if (up === dir || up === '') break
            dir = up
          }
          if (!found) missing.push(`${m[1].slice('/node_modules/'.length)} → ${dep}`)
        }
      }
      record('dependencias de node_modules completas dentro de app.asar', missing.length === 0, missing.length ? `faltan: ${missing.slice(0, 6).join(', ')}` : `${files.size} archivos revisados`)
    } catch (e) {
      record('dependencias de node_modules completas dentro de app.asar', false, `no se pudo revisar: ${String(e?.message ?? e).slice(0, 120)}`)
    }
  } else {
    record('dependencias de node_modules completas dentro de app.asar', false, 'falta Contents/Resources/app.asar')
  }
  // El pin de ArtCraft (descarga bajo demanda) debe viajar dentro del paquete: sin él la bienvenida y Ajustes no sabrían qué descargar.
  const craftPin = join(res, 'app.asar.unpacked/resources/craft/pin.json')
  const craftOk = existsSync(craftPin) && /"deckcraft"/.test(readFileSync(craftPin, 'utf8'))
  record('pin de ArtCraft incluido (descarga bajo demanda)', craftOk, craftOk ? 'presente' : 'falta resources/craft/pin.json en app.asar.unpacked')
  // El pin de Node.js y uv (conectores locales) también: sin él no hay nada que descargar ni verificar.
  const rtPin = join(res, 'app.asar.unpacked/resources/runtimes/pin.json')
  const rtOk = existsSync(rtPin) && /"node"/.test(readFileSync(rtPin, 'utf8')) && /"uv"/.test(readFileSync(rtPin, 'utf8'))
  record('pin de Node.js y uv incluido (descarga bajo demanda)', rtOk, rtOk ? 'presente' : 'falta resources/runtimes/pin.json en app.asar.unpacked')
  // El servidor MCP del shell en segundo plano (generado por `npm run build:shell-bg`) debe viajar FUERA del asar: Node no ejecuta scripts de dentro.
  const bgMcp = join(res, 'app.asar.unpacked/resources/shell-bg/shell-bg-mcp.cjs')
  const bgOk = existsSync(bgMcp) && statSync(bgMcp).size > 1000 && /bgshell/.test(readFileSync(bgMcp, 'utf8'))
  record('servidor MCP del shell en segundo plano fuera del asar', bgOk, bgOk ? `${statSync(bgMcp).size} bytes` : 'falta resources/shell-bg/shell-bg-mcp.cjs en app.asar.unpacked (¿corrió `npm run build:shell-bg`?)')
  // El motor de presentaciones del Chat para las Tareas (generado por `npm run build:chat-deck`) viaja con la skill pptx, fuera del asar.
  const deckCli = join(res, 'app.asar.unpacked/resources/opencode/skills/pptx/scripts/build_chat_deck.cjs')
  const deckCliOk = existsSync(deckCli) && statSync(deckCli).size > 1000 && /isPptxSpec|Presentación creada/.test(readFileSync(deckCli, 'utf8'))
  record('motor de presentaciones del Chat (build_chat_deck.cjs) en la skill pptx', deckCliOk, deckCliOk ? `${statSync(deckCli).size} bytes` : 'falta build_chat_deck.cjs en app.asar.unpacked (¿corrió `npm run build:chat-deck`?)')
  const skillsDir = join(root, 'resources/opencode/skills')
  for (const sk of ['docx', 'xlsx', 'pptx', 'pdf', 'ruta-rapida', 'soporte-remoto']) {
    const candidates = [join(res, 'app.asar.unpacked/resources/opencode/skills', sk, 'SKILL.md')]
    const found = candidates.find((c) => existsSync(c))
    record(
      `skill incluida: ${sk}`,
      Boolean(found) && existsSync(join(skillsDir, sk, 'SKILL.md')),
      found ? 'presente' : 'falta en app.asar.unpacked'
    )
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
        const r = await fetch(`http://127.0.0.1:${port}/global/health`, {
          headers: { authorization: auth },
          signal: AbortSignal.timeout(2000)
        })
        if (r.ok) body = await r.json()
      } catch {}
      if (!body) await new Promise((r) => setTimeout(r, 300))
    }
    const ms = Date.now() - t0
    const ok = Boolean(body?.healthy) && body.version === pin.version
    record(
      'binario sirve /global/health dentro del Seatbelt de Tareas',
      ok,
      body ? `healthy=${body.healthy} version=${body.version} en ${ms} ms` : `sin respuesta (exit=${exited}) ${tail.trim().slice(-300)}`
    )
    // El perfil sigue aislando: lectura de userData denegada dentro del sandbox.
    const deny = run('/usr/bin/sandbox-exec', ['-f', profile, '/bin/cat', join(userData, 'secreto.txt')])
    record(
      'el perfil deniega leer userData (control negativo)',
      deny.status !== 0 && !(deny.stdout || '').includes('secreto'),
      `exit=${deny.status}`
    )
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
