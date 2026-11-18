/** Se ejecuta en afterPack, antes de firmar, tanto en Mac como en Windows. Sin descargas. */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export function checkVideoBundle(resources, platform) {
  if (!['darwin', 'win32'].includes(platform)) throw new Error(`Plataforma de video no soportada: ${platform}`)
  const dir = join(resources, 'app.asar.unpacked/resources/video')
  const pin = JSON.parse(readFileSync(join(dir, 'pin.json'), 'utf8'))
  for (const part of ['chrome', 'ffmpeg', ...(platform === 'darwin' ? ['ffprobe'] : [])]) {
    if (!pin[part]?.assets?.[platform === 'darwin' ? 'darwin-arm64' : 'win32-x64']) {
      throw new Error(`Video: falta ${part} para ${platform} en pin.json`)
    }
  }
  for (const [file, field] of [
    ['package.json', 'packageSha256'],
    ['package-lock.json', 'lockSha256']
  ]) {
    const bytes = readFileSync(join(dir, 'hyperframes', file))
    if (createHash('sha256').update(bytes).digest('hex') !== pin.hyperframes?.[field]) {
      throw new Error(`Video: ${file} no coincide con pin.json`)
    }
  }
  console.log(`[check-video-bundle] OK: pin, package y lockfile de video (${platform})`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  checkVideoBundle(process.argv[2], process.argv[3] ?? process.platform)
}
