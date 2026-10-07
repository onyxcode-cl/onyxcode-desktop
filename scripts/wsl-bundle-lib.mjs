// Utilidades COMUNES del paquete incluido de «Tareas en Windows» (beta opcional, decisión del dueño 2026-10-07):
// la imagen base de WSL y el opencode `linux-x64` viajan dentro del instalador (`resources\wsl\images`), fuera de git.
// Lo usan `stage-wsl-bundle.mjs` (copia con verificación) y `check-win-bundle.mjs` (comprobación previa al empaquetado).
// Sin red y sin descargar nada: solo compara archivos locales con la huella de `resources/opencode-bin/pin.json`.
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { lstat } from 'node:fs/promises'
import { basename, join } from 'node:path'

/** Carpeta de staging (ignorada por git) que lee `electron-builder.js`. */
export const STAGING_DIR = 'resources/wsl-images'
const HEX64 = /^[0-9a-f]{64}$/

/** Nombre de la imagen para una versión `YYYY.M.D` (el mismo que `wslRootfsUrl`). */
export const rootfsFileName = (version) => `lazunox-rootfs-${version}-x64.tar.gz`

/**
 * Los dos archivos que debe llevar el paquete, según el pin ya leído (objeto JSON).
 * Devuelve `{ files: [{ kind, name, size, sha256 }] }` o lanza un Error con el motivo (falla cerrado).
 */
export function bundleFilesFromPin(pin) {
  const rootfs = pin?.['wsl-rootfs']
  const oc = pin?.assets?.['linux-x64']
  const bad = (m) => {
    throw new Error(`pin.json: ${m}`)
  }
  if (!rootfs) bad('falta «wsl-rootfs»')
  if (!oc) bad('falta assets["linux-x64"]')
  if (typeof rootfs.version !== 'string' || !/^\d{4}\.\d{1,2}\.\d{1,2}$/.test(rootfs.version)) bad('wsl-rootfs.version inválida')
  for (const [k, e] of [
    ['wsl-rootfs', rootfs],
    ['linux-x64', oc]
  ]) {
    if (typeof e.sha256 !== 'string' || !HEX64.test(e.sha256)) bad(`${k}.sha256 inválido`)
    if (!Number.isSafeInteger(e.size) || e.size <= 0) bad(`${k}.size inválido`)
  }
  if (
    typeof oc.url !== 'string' ||
    !/^https:\/\/github\.com\/anomalyco\/opencode\/releases\/download\/v[\d.]+\/[0-9A-Za-z._-]+\.tar\.gz$/.test(oc.url)
  )
    bad('linux-x64.url no es del release oficial')
  return {
    files: [
      { kind: 'rootfs', name: rootfsFileName(rootfs.version), size: rootfs.size, sha256: rootfs.sha256 },
      { kind: 'opencode', name: basename(oc.url), size: oc.size, sha256: oc.sha256 }
    ]
  }
}

/** SHA-256 en flujo. */
export function sha256File(path) {
  return new Promise((resolve, reject) => {
    const h = createHash('sha256')
    createReadStream(path)
      .on('error', reject)
      .on('data', (c) => h.update(c))
      .on('end', () => resolve(h.digest('hex')))
  })
}

/**
 * Comprueba un archivo contra `{ size, sha256 }`: debe existir, ser un archivo normal (no enlace), tener el tamaño exacto y la huella.
 * Devuelve `null` si coincide o el motivo (texto) si no. Nunca lanza.
 */
export async function verifyFile(path, { size, sha256 }) {
  let st
  try {
    st = await lstat(path)
  } catch {
    return 'no existe'
  }
  if (st.isSymbolicLink() || !st.isFile()) return 'no es un archivo normal'
  if (st.size !== size) return `tamaño ${st.size} ≠ ${size}`
  try {
    const got = await sha256File(path)
    return got === sha256 ? null : `sha256 ${got} ≠ ${sha256}`
  } catch {
    return 'no se pudo leer'
  }
}

/** Problemas (lista, vacía si todo bien) del paquete en `dir` frente al pin. */
export async function checkBundleDir(dir, pin) {
  const problems = []
  let spec
  try {
    spec = bundleFilesFromPin(pin)
  } catch (e) {
    return [e.message]
  }
  for (const f of spec.files) {
    const why = await verifyFile(join(dir, f.name), f)
    if (why) problems.push(`${STAGING_DIR}/${f.name}: ${why}`)
  }
  return problems
}
