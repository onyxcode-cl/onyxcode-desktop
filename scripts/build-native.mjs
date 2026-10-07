#!/usr/bin/env node
// Compila (si faltan) el helper de computer use y el lanzador "disclaim" de macOS. Fuera de macOS no
// hace nada (esos binarios solo existen en darwin): así `npm run dev` / `npm run build` no dependen
// de `sh` en Windows. Sin dependencias.
//
// Helper de Control del PC para Windows (Rust, resources/computer-use/win): SOLO SI SE PIDE, nunca en `npm run dev`,
// `npm run build` ni `npm run package:win` (no se incluye en el instalador hasta que se active la función):
//   node scripts/build-native.mjs --win-helper [--target <triple>] [--jobs N]   compila → resources/computer-use/win/bin/cu-helper.exe
//   node scripts/build-native.mjs --win-helper-test [--jobs N]                  cargo test nativo (lo puro; en cualquier sistema)
// Requisitos (NO se instalan solos; si faltan, se dice qué falta y se sale con error):
//   - Rust (rustup) con el objetivo x86_64-pc-windows-gnu y, fuera de Windows, mingw-w64 (`x86_64-w64-mingw32-gcc`).
//   - En un Windows con Rust MSVC: sin --target compila para el objetivo del anfitrión.
// Reproducible: usa `--locked` (Cargo.lock está versionado) y dependencias fijadas con `=`.
import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { homedir, setPriority } from 'node:os'
import { delimiter, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const argv = process.argv.slice(2)

const WIN_DIR = join(root, 'resources', 'computer-use', 'win')
const DEFAULT_GNU = 'x86_64-pc-windows-gnu'

/** Valor de `--flag valor` o `--flag=valor`. */
function flagValue(args, name) {
  const i = args.findIndex((a) => a === name || a.startsWith(`${name}=`))
  if (i < 0) return undefined
  return args[i].includes('=') ? args[i].slice(name.length + 1) : args[i + 1]
}

/** Plan de compilación del helper de Windows (puro: sin tocar el disco ni ejecutar nada). */
export function planWinHelper(args, platform = process.platform) {
  const jobs = Number(flagValue(args, '--jobs') ?? process.env.CU_CARGO_JOBS ?? 2)
  if (!Number.isInteger(jobs) || jobs < 1 || jobs > 16) throw new Error('--jobs debe ser un entero entre 1 y 16')
  const explicit = flagValue(args, '--target')
  if (explicit !== undefined && !/^[a-z0-9_]+(-[a-z0-9_]+){2,3}$/.test(explicit)) throw new Error(`--target no válido: ${explicit}`)
  const target = explicit ?? (platform === 'win32' ? undefined : DEFAULT_GNU)
  const exe = target ? join(WIN_DIR, 'target', target, 'release', 'cu-helper.exe') : join(WIN_DIR, 'target', 'release', 'cu-helper.exe')
  const needsMingw = platform !== 'win32' && (target ?? '').endsWith('-gnu')
  return { jobs, target, exe, out: join(WIN_DIR, 'bin', 'cu-helper.exe'), needsMingw }
}

function pathWithCargo() {
  return [join(homedir(), '.cargo', 'bin'), process.env.PATH ?? ''].join(delimiter)
}

function run(cmd, args, opts = {}) {
  return spawnSync(cmd, args, { stdio: 'inherit', cwd: WIN_DIR, env: { ...process.env, PATH: pathWithCargo() }, ...opts })
}

function have(cmd, args = ['--version']) {
  const r = spawnSync(cmd, args, { stdio: 'ignore', env: { ...process.env, PATH: pathWithCargo() } })
  return r.status === 0
}

function lowPriority() {
  try {
    setPriority(10)
  } catch {
    /* sin permiso: se sigue con la prioridad normal */
  }
}

function winHelperTest(args) {
  const { jobs } = planWinHelper(args)
  if (!have('cargo')) {
    console.error('[build-native] falta cargo (instala Rust con rustup); no se instala solo.')
    return 1
  }
  lowPriority()
  return run('cargo', ['test', '--locked', '-j', String(jobs)]).status ?? 1
}

function winHelperBuild(args) {
  const plan = planWinHelper(args)
  const missing = []
  if (!have('cargo')) missing.push('cargo (instala Rust con rustup)')
  if (plan.target && have('rustup')) {
    const r = spawnSync('rustup', ['target', 'list', '--installed'], { encoding: 'utf8', env: { ...process.env, PATH: pathWithCargo() } })
    if (!(r.stdout ?? '').split(/\s+/).includes(plan.target))
      missing.push(`el objetivo de Rust ${plan.target} (rustup target add ${plan.target})`)
  }
  if (plan.needsMingw && !have('x86_64-w64-mingw32-gcc'))
    missing.push('mingw-w64 (x86_64-w64-mingw32-gcc; en macOS: brew install mingw-w64)')
  if (missing.length) {
    console.error(`[build-native] no se puede compilar el helper de Windows; falta: ${missing.join('; ')}. No se instala nada solo.`)
    return 1
  }
  lowPriority()
  const cargoArgs = ['build', '--release', '--locked', '-j', String(plan.jobs)]
  if (plan.target) cargoArgs.push('--target', plan.target)
  const r = run('cargo', cargoArgs)
  if (r.status !== 0) return r.status ?? 1
  if (!existsSync(plan.exe)) {
    console.error(`[build-native] cargo terminó sin error pero falta ${plan.exe}`)
    return 1
  }
  mkdirSync(dirname(plan.out), { recursive: true })
  copyFileSync(plan.exe, plan.out)
  const sha = createHash('sha256').update(readFileSync(plan.out)).digest('hex')
  console.log(`[build-native] cu-helper.exe: ${plan.out}\n  tamaño: ${statSync(plan.out).size} bytes\n  sha256: ${sha}`)
  return 0
}

/** ¿Se ejecuta como programa (y no importado desde una prueba)? Compara rutas reales (enlaces simbólicos). */
function isMain() {
  try {
    return !!process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
  } catch {
    return true
  }
}

if (isMain()) {
  if (argv.includes('--win-helper-test')) process.exit(winHelperTest(argv))
  if (argv.includes('--win-helper')) process.exit(winHelperBuild(argv))

  if (process.platform !== 'darwin') {
    console.log('[build-native] omitido (solo macOS: cu-helper y lazunox-disclaim)')
    process.exit(0)
  }

  for (const dir of ['computer-use', 'launcher']) {
    const r = spawnSync('sh', [join(root, 'resources', dir, 'build.sh'), '--if-missing'], { stdio: 'inherit', cwd: root })
    if (r.status !== 0) process.exit(r.status ?? 1)
  }
}
