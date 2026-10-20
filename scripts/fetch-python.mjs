#!/usr/bin/env node
// Descarga el Python PROPIO de Lazunox (python-build-standalone, fijado en resources/python-bin/pin.json), instala
// las librerías de oficina de resources/python-bin/requirements.txt con ESE intérprete y lo deja en
// resources/python-bin/mac-<arm64|x64>/python/ (bin/python3). Lo empaqueta electron-builder vía extraResources, así las
// skills de oficina no dependen del Python del Mac del usuario. Sin dependencias: https de Node, crypto y `tar` del sistema.
//
// Uso: node scripts/fetch-python.mjs [--if-missing] [--arch arm64|x64]
//   --if-missing  no hace nada si ya hay una instalación con el sello `.lazunox-python` que coincide con el pin y los requisitos.
//   --arch        arquitectura destino (por defecto la del proceso). Para x64 en un Mac arm64 hace falta Rosetta.
//
// Garantías: el .tar.gz se verifica (tamaño y SHA-256) ANTES de extraer; si no coincide no se extrae nada. Todo se prepara
// en una carpeta temporal y solo se mueve a su sitio si la verificación final (importar las 10 librerías y generar un .docx)
// pasa. Sin red falla con un error explícito. Solo se engancha en `npm run package`.
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
  lstatSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { downloadFile, verifyDownload } from './fetch-opencode.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
export const PY_DIR = join(ROOT, 'resources', 'python-bin')
export const PIN_PATH = join(PY_DIR, 'pin.json')
export const REQUIREMENTS_PATH = join(PY_DIR, 'requirements.txt')
export const SEAL_NAME = '.lazunox-python'
export const ARCHS = ['arm64', 'x64']
/** Módulos de importación de las 10 librerías de oficina. */
export const OFFICE_MODULES = ['docx', 'openpyxl', 'pptx', 'pypdf', 'pdfplumber', 'reportlab', 'pypdfium2', 'PIL', 'lxml', 'fitz']

const URL_RE = /^https:\/\/github\.com\/astral-sh\/python-build-standalone\/releases\/download\/[^\s]+\.tar\.gz$/
const validAsset = (a) =>
  !!a && typeof a.url === 'string' && URL_RE.test(a.url) && /^[0-9a-f]{64}$/.test(a.sha256) && Number.isInteger(a.size) && a.size > 0

/** Clave de plataforma del pin: `darwin-arm64` | `darwin-x64`. */
export function pinKey(arch) {
  if (!ARCHS.includes(arch)) throw new Error(`Arquitectura no soportada: ${arch} (usa ${ARCHS.join(' o ')}).`)
  return `darwin-${arch}`
}

/** Carpeta destino de la instalación: resources/python-bin/mac-<arch>/python */
export function pythonDir(arch, base = PY_DIR) {
  return join(base, `mac-${arch}`, 'python')
}

export const pythonBin = (arch, base = PY_DIR) => join(pythonDir(arch, base), 'bin', 'python3')

/** Valida y devuelve el pin; lanza si falta algo o no es de github.com/astral-sh. */
export function parsePin(text, label = 'pin.json') {
  let pin
  try {
    pin = JSON.parse(text)
  } catch (e) {
    throw new Error(`${label} no es JSON válido: ${e.message}`)
  }
  if (
    !pin ||
    !/^3\.\d+\.\d+$/.test(pin.python ?? '') ||
    !/^\d{8}$/.test(pin.release ?? '') ||
    !pin.assets ||
    typeof pin.assets !== 'object'
  ) {
    throw new Error(`${label} inválido: faltan python/release/assets`)
  }
  for (const key of ['darwin-arm64', 'darwin-x64']) {
    if (!validAsset(pin.assets[key]))
      throw new Error(`${label} inválido (asset ${key}): url https de github.com/astral-sh, sha256 de 64 hex y size entero`)
  }
  return pin
}

export const readPin = (path = PIN_PATH) => parsePin(readFileSync(path, 'utf8'), path)

export function assetFor(pin, arch) {
  const asset = pin.assets?.[pinKey(arch)]
  if (!validAsset(asset)) throw new Error(`No hay Python fijado para ${pinKey(arch)}.`)
  return asset
}

/** Líneas de requisitos sin comentarios ni vacías. */
export function parseRequirements(text) {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
}

export const sha256Text = (t) => createHash('sha256').update(t).digest('hex')

/** Rutas (relativas a python/) que se borran para reducir tamaño. Ninguna es necesaria para las 10 librerías. */
export const PRUNE_PATHS = [
  'include',
  'share',
  'lib/pkgconfig',
  'lib/itcl4.3.8',
  'lib/tcl9.0',
  'lib/tk9.0',
  'lib/tcl9',
  'lib/libtcl9.0.dylib',
  'lib/libtcl9tk9.0.dylib',
  'lib/libpython3.12.a',
  'lib/python3.12/test',
  'lib/python3.12/idlelib',
  'lib/python3.12/tkinter',
  'lib/python3.12/turtledemo',
  'lib/python3.12/turtle.py',
  'lib/python3.12/lib2to3',
  'lib/python3.12/pydoc_data',
  'lib/python3.12/ensurepip',
  'lib/python3.12/config-3.12-darwin',
  'lib/python3.12/site-packages/pip',
  'lib/python3.12/site-packages/setuptools',
  'lib/python3.12/site-packages/pkg_resources',
  'lib/python3.12/site-packages/_distutils_hack',
  'lib/python3.12/site-packages/distutils-precedence.pth'
]
/** Patrones por prefijo dentro de una carpeta: [carpeta, prefijo]. */
export const PRUNE_PREFIXES = [
  ['lib/python3.12/lib-dynload', '_tkinter'],
  ['lib/python3.12/site-packages', 'pip-'],
  ['lib/python3.12/site-packages', 'setuptools-']
]
/** Ejecutables de bin/ que se conservan (el resto: pip, idle, pydoc, *-config… se borra). */
export const KEEP_BIN = ['python3', 'python3.12']

function run(cmd, args, options = {}) {
  return new Promise((resolveRun, reject) => {
    execFile(cmd, args, { timeout: 600_000, maxBuffer: 16 * 1024 * 1024, ...options }, (err, stdout, stderr) => {
      if (err) return reject(new Error(`${cmd} ${args.join(' ')} falló: ${(stderr || '').toString().trim().slice(-2000) || err.message}`))
      resolveRun(stdout.toString().trim())
    })
  })
}

/** Entorno mínimo y aislado para ejecutar el Python extraído (nunca toca HOME ni el Python del usuario). */
const pyEnv = (home) => ({
  PATH: '/usr/bin:/bin',
  HOME: home,
  TMPDIR: home,
  PYTHONNOUSERSITE: '1',
  PYTHONDONTWRITEBYTECODE: '1',
  PIP_DISABLE_PIP_VERSION_CHECK: '1'
})

export function pruneInstall(pyRoot) {
  for (const rel of PRUNE_PATHS) rmSync(join(pyRoot, rel), { recursive: true, force: true })
  for (const [dir, prefix] of PRUNE_PREFIXES) {
    const abs = join(pyRoot, dir)
    if (!existsSync(abs)) continue
    for (const name of readdirSync(abs)) if (name.startsWith(prefix)) rmSync(join(abs, name), { recursive: true, force: true })
  }
  const bin = join(pyRoot, 'bin')
  for (const name of readdirSync(bin)) if (!KEEP_BIN.includes(name)) rmSync(join(bin, name), { recursive: true, force: true })
  // __pycache__, .pyc sueltos y documentación suelta; recorrido manual (sin dependencias).
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name)
      const st = lstatSync(p)
      if (st.isSymbolicLink()) continue
      if (st.isDirectory()) {
        if (name === '__pycache__') rmSync(p, { recursive: true, force: true })
        else walk(p)
      } else if (name.endsWith('.pyc')) rmSync(p, { force: true })
    }
  }
  walk(pyRoot)
}

const VERIFY_PY = `
import importlib, importlib.metadata as md, json, os, sys, tempfile
mods = ${JSON.stringify(OFFICE_MODULES)}
for m in mods:
    importlib.import_module(m)
import docx
d = docx.Document(); d.add_heading('Lazunox', 1); d.add_paragraph('prueba')
out = os.path.join(tempfile.mkdtemp(), 'prueba.docx'); d.save(out)
assert len(docx.Document(out).paragraphs) >= 2 and os.path.getsize(out) > 1000
import pypdfium2, PIL.Image, reportlab.pdfgen.canvas, lxml.etree
print(json.dumps({'python': sys.version.split()[0], 'docx': out}))
`

function dirSize(dir) {
  let total = 0
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    const st = lstatSync(p)
    total += st.isDirectory() && !st.isSymbolicLink() ? dirSize(p) : st.size
  }
  return total
}

/** Importa las 10 librerías y genera un .docx mínimo con el intérprete dado. Devuelve la versión de Python. */
export async function verifyInstall(pyBin, home) {
  const out = await run(pyBin, ['-I', '-c', VERIFY_PY], { cwd: home, env: pyEnv(home) })
  return JSON.parse(out.split('\n').pop()).python
}

function readSeal(pyRoot) {
  try {
    return JSON.parse(readFileSync(join(pyRoot, SEAL_NAME), 'utf8'))
  } catch {
    return null
  }
}

export function expectedSeal(pin, arch, requirementsText) {
  return { python: pin.python, release: pin.release, arch, requirementsSha256: sha256Text(parseRequirements(requirementsText).join('\n')) }
}

const sealMatches = (seal, want) => !!seal && ['python', 'release', 'arch', 'requirementsSha256'].every((k) => seal[k] === want[k])

/** Descarga, verifica, extrae, instala, poda, verifica y mueve a su sitio. */
export async function fetchPython({
  pin,
  arch = process.arch,
  base = PY_DIR,
  ifMissing = false,
  log = console.log,
  requirementsPath = REQUIREMENTS_PATH
} = {}) {
  pin ??= readPin()
  const asset = assetFor(pin, arch)
  const requirementsText = readFileSync(requirementsPath, 'utf8')
  const want = expectedSeal(pin, arch, requirementsText)
  const dest = pythonDir(arch, base)
  if (ifMissing && existsSync(pythonBin(arch, base)) && sealMatches(readSeal(dest), want)) {
    log(`[fetch-python] ya presente: Python ${pin.python} (${dest})`)
    return { status: 'present', path: dest }
  }

  mkdirSync(dirname(dest), { recursive: true })
  const work = mkdtempSync(join(dirname(dest), '.fetch-'))
  try {
    const tgz = join(work, 'python.tar.gz')
    log(`[fetch-python] descargando Python ${pin.python} (${arch}, ${(asset.size / 1048576).toFixed(1)} MB)…`)
    try {
      await downloadFile(asset.url, tgz)
    } catch (err) {
      throw new Error(`No se pudo descargar ${asset.url} (¿sin red?): ${err instanceof Error ? err.message : err}`)
    }
    await verifyDownload(tgz, asset) // ANTES de extraer
    const out = join(work, 'out')
    mkdirSync(out)
    await run('/usr/bin/tar', ['-xzf', tgz, '-C', out])
    rmSync(tgz, { force: true })
    const root = join(out, 'python')
    const py = join(root, 'bin', 'python3')
    if (!existsSync(py)) throw new Error('El archivo no contiene python/bin/python3.')

    const home = join(work, 'home')
    mkdirSync(home)
    log('[fetch-python] instalando librerías de oficina…')
    await run(py, ['-I', '-m', 'pip', 'install', '--no-compile', '--only-binary=:all:', '--no-cache-dir', '-r', requirementsPath], {
      cwd: home,
      env: pyEnv(home)
    })
    const frozen = (await run(py, ['-I', '-m', 'pip', 'freeze'], { cwd: home, env: pyEnv(home) })).split('\n').filter(Boolean)

    log('[fetch-python] podando lo innecesario…')
    pruneInstall(root)
    const version = await verifyInstall(py, home)
    if (version !== pin.python) throw new Error(`El intérprete dice ser ${version}, el pin es ${pin.python}.`)
    pruneInstall(root) // por si la verificación dejó algún __pycache__

    writeFileSync(join(root, SEAL_NAME), JSON.stringify({ ...want, packages: frozen, pin: asset.sha256 }, null, 2) + '\n')
    rmSync(dest, { recursive: true, force: true })
    renameSync(root, dest)
    const mb = dirSize(dest) / 1048576
    log(`[fetch-python] OK: Python ${version} + ${frozen.length} paquetes → ${dest} (${mb.toFixed(1)} MB)`)
    return { status: 'fetched', path: dest, sizeMB: mb }
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
}

export function parseArgs(argv) {
  const args = { ifMissing: argv.includes('--if-missing'), arch: process.arch === 'x64' ? 'x64' : 'arm64' }
  const i = argv.indexOf('--arch')
  if (i >= 0) args.arch = argv[i + 1]
  pinKey(args.arch) // valida
  return args
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.platform !== 'darwin') {
    console.log('[fetch-python] solo macOS: nada que hacer en esta plataforma.')
  } else {
    try {
      const { ifMissing, arch } = parseArgs(process.argv.slice(2))
      await fetchPython({ ifMissing, arch })
    } catch (err) {
      console.error(`[fetch-python] ERROR: ${err instanceof Error ? err.message : err}`)
      process.exit(1)
    }
  }
}
