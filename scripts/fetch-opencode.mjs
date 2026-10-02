#!/usr/bin/env node
// Descarga el binario OFICIAL de OpenCode fijado en resources/opencode-bin/pin.json y lo deja en
// resources/opencode-bin/bin/opencode (macOS) u opencode.exe (Windows); lo empaqueta electron-builder
// vía extraResources. Sin dependencias: `https`/`http` de Node, `crypto` y el descompresor del sistema
// (`ditto` en macOS, `tar.exe` de System32 en Windows).
//
// Uso: node scripts/fetch-opencode.mjs [--if-missing]
//   --if-missing  no hace nada si ya hay un binario que responde con `pin.version`.
//
// Garantías: el ZIP se verifica (tamaño y SHA-256) ANTES de descomprimir; si no coincide se borra
// lo descargado y NO se extrae nada. Sin red falla con un error explícito (nunca deja un binario
// a medias). Solo se engancha en `npm run package`, no en dev/build/verify.
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, statSync, chmodSync } from 'node:fs'
import { get as httpGet } from 'node:http'
import { get as httpsGet } from 'node:https'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
export const PIN_PATH = join(ROOT, 'resources', 'opencode-bin', 'pin.json')
export const BIN_DIR = join(ROOT, 'resources', 'opencode-bin', 'bin')
const MAX_REDIRECTS = 5
const NET_TIMEOUT_MS = 60_000

/** Clave de plataforma del pin: `darwin-arm64`, `win32-x64`… */
export function platformKey(platform = process.platform, arch = process.arch) {
  return `${platform}-${arch}`
}

/** Nombre del ejecutable de OpenCode en la plataforma. */
export function binaryName(platform = process.platform) {
  return platform === 'win32' ? 'opencode.exe' : 'opencode'
}

const validAsset = (a) => !!a && typeof a.url === 'string' && /^[0-9a-f]{64}$/.test(a.sha256) && Number.isInteger(a.size)

export function readPin(path = PIN_PATH) {
  const pin = JSON.parse(readFileSync(path, 'utf8'))
  if (!pin || typeof pin.version !== 'string' || !pin.assets || typeof pin.assets !== 'object') throw new Error(`pin.json inválido: ${path}`)
  for (const [key, asset] of Object.entries(pin.assets)) {
    if (!validAsset(asset)) throw new Error(`pin.json inválido (asset ${key}): ${path}`)
  }
  return pin
}

/** Asset del pin para una plataforma; lanza un error claro si no hay binario fijado para ella. */
export function assetFor(pin, key = platformKey()) {
  const asset = pin.assets?.[key]
  if (!validAsset(asset)) throw new Error(`No hay binario de OpenCode fijado para ${key} (disponibles: ${Object.keys(pin.assets ?? {}).join(', ') || 'ninguno'}).`)
  return asset
}

/** Descomprime un ZIP con la herramienta del sistema (ditto en macOS, tar.exe de System32 en Windows). */
export function unzipCommand(platform, zip, dest) {
  if (platform === 'win32') {
    const tar = join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe')
    return [tar, ['-xf', zip, '-C', dest]]
  }
  if (platform === 'darwin') return ['ditto', ['-x', '-k', zip, dest]]
  throw new Error(`Plataforma no soportada para extraer el ZIP: ${platform}`)
}

/** SHA-256 (hex) de un archivo, en streaming. */
export function sha256File(file) {
  return new Promise((resolveHash, reject) => {
    const hash = createHash('sha256')
    createReadStream(file)
      .on('error', reject)
      .on('data', (d) => hash.update(d))
      .on('end', () => resolveHash(hash.digest('hex')))
  })
}

/** Lanza si el tamaño o el SHA-256 del archivo no coinciden con el pin. */
export async function verifyDownload(file, asset) {
  const size = statSync(file).size
  if (size !== asset.size) throw new Error(`Tamaño distinto al fijado: ${size} bytes (esperado ${asset.size}).`)
  const actual = await sha256File(file)
  if (actual !== asset.sha256) throw new Error(`SHA-256 distinto al fijado: ${actual} (esperado ${asset.sha256}).`)
}

/** Descarga `url` a `dest` siguiendo redirects (https, o http solo para el servidor de fixture de los tests). */
export function downloadFile(url, dest, redirects = 0) {
  return new Promise((resolveDl, reject) => {
    let u
    try {
      u = new URL(url)
    } catch {
      return reject(new Error(`URL inválida: ${url}`))
    }
    const get = u.protocol === 'https:' ? httpsGet : u.protocol === 'http:' ? httpGet : null
    if (!get) return reject(new Error(`Protocolo no soportado: ${u.protocol}`))
    const req = get(u, { headers: { 'user-agent': 'onyxcode-fetch-opencode' }, timeout: NET_TIMEOUT_MS }, (res) => {
      const status = res.statusCode ?? 0
      if (status >= 300 && status < 400 && res.headers.location) {
        res.resume()
        if (redirects >= MAX_REDIRECTS) return reject(new Error('Demasiadas redirecciones.'))
        return resolveDl(downloadFile(new URL(res.headers.location, u).toString(), dest, redirects + 1))
      }
      if (status !== 200) {
        res.resume()
        return reject(new Error(`La descarga respondió HTTP ${status}.`))
      }
      const out = createWriteStream(dest)
      res.on('error', (e) => out.destroy(e))
      out.on('error', reject)
      out.on('finish', () => resolveDl())
      res.pipe(out)
    })
    req.on('timeout', () => req.destroy(new Error('La descarga se quedó sin respuesta (timeout).')))
    req.on('error', reject)
  })
}

function run(cmd, args, options = {}) {
  return new Promise((resolveRun, reject) => {
    execFile(cmd, args, { timeout: 30_000, maxBuffer: 1024 * 1024, ...options }, (err, stdout, stderr) => {
      if (err) return reject(new Error(`${cmd} ${args.join(' ')} falló: ${stderr.toString().trim() || err.message}`))
      resolveRun(stdout.toString().trim() || stderr.toString().trim())
    })
  })
}

/** `<bin> --version` con entorno mínimo y HOME/XDG temporales (nunca toca los del usuario). */
export async function binaryVersion(bin) {
  const home = mkdtempSync(join(tmpdir(), 'onyx-fetch-home-'))
  try {
    const win = process.platform === 'win32'
    const sysRoot = process.env.SystemRoot || 'C:\\Windows'
    const out = await run(bin, ['--version'], {
      cwd: home,
      windowsHide: true,
      env: {
        PATH: win ? `${sysRoot}\\System32;${sysRoot}` : '/usr/bin:/bin',
        ...(win ? { SystemRoot: sysRoot, USERPROFILE: home, APPDATA: join(home, 'appdata'), LOCALAPPDATA: join(home, 'localappdata'), TEMP: home, TMP: home } : {}),
        HOME: home,
        XDG_CONFIG_HOME: join(home, 'config'),
        XDG_DATA_HOME: join(home, 'data'),
        XDG_CACHE_HOME: join(home, 'cache'),
        XDG_STATE_HOME: join(home, 'state'),
        TMPDIR: home,
        OPENCODE_DISABLE_AUTOUPDATE: '1'
      }
    })
    return /\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?/.exec(out)?.[0] ?? null
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
}

/**
 * Descarga, verifica y extrae. Devuelve `{ status: 'present' | 'fetched', path, version }`.
 * `binDir` y `log` se inyectan para los tests.
 */
export async function fetchOpencode({
  pin,
  binDir = BIN_DIR,
  ifMissing = false,
  log = console.log,
  platform = process.platform,
  key = platformKey(platform),
  versionOf = binaryVersion
} = {}) {
  pin ??= readPin()
  const asset = assetFor(pin, key)
  const name = binaryName(platform)
  const target = join(binDir, name)
  if (ifMissing && existsSync(target)) {
    try {
      const version = await versionOf(target)
      if (version === pin.version) {
        log(`[fetch-opencode] ya presente: OpenCode ${version} (${target})`)
        return { status: 'present', path: target, version }
      }
      log(`[fetch-opencode] hay un binario ${version ?? 'ilegible'} pero el pin es ${pin.version}: se vuelve a descargar`)
    } catch {
      log('[fetch-opencode] el binario existente no responde: se vuelve a descargar')
    }
  }

  mkdirSync(dirname(binDir), { recursive: true })
  const work = mkdtempSync(join(dirname(binDir), '.fetch-'))
  try {
    const zip = join(work, 'opencode.zip')
    log(`[fetch-opencode] descargando OpenCode ${pin.version}…`)
    try {
      await downloadFile(asset.url, zip)
    } catch (err) {
      throw new Error(`No se pudo descargar ${asset.url} (¿sin red?): ${err instanceof Error ? err.message : err}`)
    }
    await verifyDownload(zip, asset) // ANTES de descomprimir
    const extracted = join(work, 'out')
    mkdirSync(extracted)
    const [cmd, args] = unzipCommand(platform, zip, extracted)
    await run(cmd, args)
    const bin = join(extracted, name)
    if (!existsSync(bin)) throw new Error(`El ZIP no contiene el binario \`${name}\`.`)
    if (platform !== 'win32') chmodSync(bin, 0o755)
    const version = await versionOf(bin)
    if (version !== pin.version) throw new Error(`El binario dice ser ${version ?? 'desconocido'}, el pin es ${pin.version}.`)
    rmSync(binDir, { recursive: true, force: true })
    mkdirSync(binDir, { recursive: true })
    renameSync(bin, target)
    log(`[fetch-opencode] OK: OpenCode ${version} → ${target}`)
    return { status: 'fetched', path: target, version }
  } finally {
    rmSync(work, { recursive: true, force: true }) // borra el zip y cualquier resto
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  fetchOpencode({ ifMissing: process.argv.includes('--if-missing') }).catch((err) => {
    console.error(`[fetch-opencode] ERROR: ${err instanceof Error ? err.message : err}`)
    process.exit(1)
  })
}
