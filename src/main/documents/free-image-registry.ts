/** Trusted, persistent photo authority in app data; task-side JSON is only an export. */
import { createHash, randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { mkdir, open, realpath, rename, rm, lstat, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { FreeImageAsset } from './free-images'
import { OutputPathError, isInside } from './output-path'

const MAX_RECORD_BYTES = 8 * 1024 * 1024
const MAX_REGISTRY_BYTES = 256 * 1024 * 1024
const MAX_REGISTRY_FILES = 5000
const digest = (value: string | Buffer): string => createHash('sha256').update(value).digest('hex')
const validSha = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
export interface RegisteredPhoto {
  sha: string
  id: string
  rel: string
  asset: FreeImageAsset
}
interface StoredPhoto {
  version: 1
  sha: string
  bytes: string
  asset: Omit<FreeImageAsset, 'bytes'>
}
interface Location {
  version: 1
  sha: string
  id: string
  rel: string
}

function validProvenance(value: unknown, sha: string): value is FreeImageAsset['provenance'] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const p = value as Record<string, unknown>
  const bounded = (v: unknown, max = 2000): v is string => typeof v === 'string' && v.length > 0 && v.length <= max
  if (
    p.status !== 'licencia-comprobada' ||
    p.provider !== 'Wikimedia Commons' ||
    p.sha256 !== sha ||
    !bounded(p.author) ||
    !bounded(p.license, 100) ||
    !bounded(p.source, 20000) ||
    !bounded(p.licenseUrl) ||
    !bounded(p.credit, 2000)
  )
    return false
  const cc = /^CC BY(-SA)? (1\.0|2\.0|2\.5|3\.0|4\.0)$/.exec(p.license)
  const expectedLicense = cc
    ? `https://creativecommons.org/licenses/${cc[1] ? 'by-sa' : 'by'}/${cc[2]}/`
    : p.license === 'CC0 1.0'
      ? 'https://creativecommons.org/publicdomain/zero/1.0/'
      : /^Dominio público \(pd-(?:old|old-70|old-100|self|user|author|usgov)\)$/.test(p.license)
        ? 'https://creativecommons.org/publicdomain/mark/1.0/'
        : null
  if (!expectedLicense || p.licenseUrl !== expectedLicense) return false
  try {
    const url = new URL(p.source)
    if (
      url.protocol !== 'https:' ||
      url.hostname !== 'commons.wikimedia.org' ||
      url.username ||
      url.password ||
      url.port ||
      !url.pathname.startsWith('/wiki/File:')
    )
      return false
  } catch {
    return false
  }
  if (p.fullCredit !== undefined && (typeof p.fullCredit !== 'string' || p.fullCredit.length > 128 * 1024)) return false
  if (p.notices !== undefined && (typeof p.notices !== 'string' || p.notices.length > 20000)) return false
  if (
    p.transformations !== undefined &&
    (!Array.isArray(p.transformations) || p.transformations.length > 30 || p.transformations.some((item) => !bounded(item, 2000)))
  )
    return false
  if (
    p.rawMetadata !== undefined &&
    (!p.rawMetadata ||
      typeof p.rawMetadata !== 'object' ||
      Array.isArray(p.rawMetadata) ||
      Object.values(p.rawMetadata).some((item) => typeof item !== 'string' || item.length > 20000))
  )
    return false
  return Buffer.byteLength(JSON.stringify(value)) <= 128 * 1024
}

export class FreeImageRegistry {
  constructor(private readonly directory: string) {}

  private async home(root: string): Promise<string> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 })
    if ((await lstat(this.directory)).isSymbolicLink()) throw new Error('Photo registry must not be a link')
    const home = await realpath(this.directory)
    const folder = await realpath(root)
    if (isInside(folder, home) || isInside(home, folder))
      throw new OutputPathError(
        'outside',
        'El registro privado de fotos no puede estar dentro de la carpeta del proyecto. Usa otra carpeta.'
      )
    return home
  }

  private async read(file: string, max: number): Promise<unknown | null> {
    try {
      const h = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
      try {
        const st = await h.stat()
        if (!st.isFile() || st.size > max || st.nlink !== 1 || (await lstat(file)).isSymbolicLink()) return null
        const bytes = Buffer.alloc(st.size + 1)
        let bytesRead = 0
        while (bytesRead < bytes.length) {
          const part = await h.read(bytes, bytesRead, bytes.length - bytesRead, bytesRead)
          if (!part.bytesRead) break
          bytesRead += part.bytesRead
        }
        if (bytesRead !== st.size) return null
        return JSON.parse(bytes.subarray(0, bytesRead).toString('utf8'))
      } finally {
        await h.close()
      }
    } catch {
      return null
    }
  }

  private async write(home: string, name: string, value: unknown): Promise<void> {
    const bytes = Buffer.from(JSON.stringify(value))
    if (bytes.length > MAX_RECORD_BYTES) throw new Error('Photo registry record too large')
    const file = join(home, `.photo-${randomUUID()}.tmp`)
    const handle = await open(file, 'wx', 0o600)
    try {
      await handle.writeFile(bytes)
      await handle.sync()
      await handle.close()
      await rename(file, join(home, name))
    } finally {
      await handle.close().catch(() => undefined)
      await rm(file, { force: true })
    }
  }

  private locationName(root: string, key: string): string {
    return `location-${digest(root)}-${digest(key)}.json`
  }

  async remember(root: string, id: string, rel: string, asset: FreeImageAsset): Promise<void> {
    const home = await this.home(root)
    const canonical = await realpath(root)
    const sha = digest(asset.bytes)
    const { bytes, ...metadata } = asset
    if (!validProvenance(asset.provenance, sha)) throw new Error('Invalid verified photo provenance')
    const files = await readdir(home)
    if (files.length + 4 > MAX_REGISTRY_FILES)
      throw new OutputPathError('size', 'El registro privado de fotos llegó a su límite; no se preparó una foto nueva.')
    let size = 0
    for (const file of files) {
      if (file === `photo-${sha}.json`) continue
      size += (await lstat(join(home, file))).size
      if (size > MAX_REGISTRY_BYTES) break
    }
    if (size + Math.ceil((bytes.length * 4) / 3) + Buffer.byteLength(JSON.stringify(metadata)) + 16384 > MAX_REGISTRY_BYTES)
      throw new OutputPathError('size', 'El registro privado de fotos llegó a su límite; no se preparó una foto nueva.')
    if (bytes.length > 5 * 1024 * 1024) throw new Error('Photo registry image too large')
    await this.write(home, `photo-${sha}.json`, { version: 1, sha, bytes: bytes.toString('base64'), asset: metadata } satisfies StoredPhoto)
    const location: Location = { version: 1, sha, id, rel }
    for (const key of [`id:${id}`, `id:preparada-${sha}`, `path:${rel.toLowerCase()}`])
      await this.write(home, this.locationName(canonical, key), location)
  }

  async get(root: string, sha: string): Promise<FreeImageAsset | null> {
    if (!validSha(sha)) return null
    const home = await this.home(root)
    const data = (await this.read(join(home, `photo-${sha}.json`), MAX_RECORD_BYTES)) as StoredPhoto | null
    if (
      !data ||
      data.version !== 1 ||
      data.sha !== sha ||
      typeof data.bytes !== 'string' ||
      !data.asset ||
      data.asset.ext !== 'jpg' ||
      typeof data.asset.credit !== 'string' ||
      !data.asset.credit.trim() ||
      data.asset.credit.length > 2000 ||
      !validProvenance(data.asset.provenance, sha)
    )
      return null
    const bytes = Buffer.from(data.bytes, 'base64')
    if (bytes.length > 5 * 1024 * 1024 || digest(bytes) !== sha) return null
    return { ...data.asset, bytes }
  }

  private async find(root: string, key: string): Promise<RegisteredPhoto | null> {
    const home = await this.home(root)
    const canonical = await realpath(root)
    const location = (await this.read(join(home, this.locationName(canonical, key)), 4096)) as Location | null
    if (
      !location ||
      location.version !== 1 ||
      !validSha(location.sha) ||
      typeof location.id !== 'string' ||
      typeof location.rel !== 'string' ||
      !/^img\/free-[a-f0-9]{20}(?: \(\d+\))?\.jpg$/.test(location.rel)
    )
      return null
    const asset = await this.get(root, location.sha)
    return asset ? { ...location, asset } : null
  }

  async findId(root: string, id: string): Promise<RegisteredPhoto | null> {
    const exact = await this.find(root, `id:${id}`)
    if (exact || !/^[0-9a-f-]{8,35}$/i.test(id)) return exact
    // Algunos modelos copian el identificador cortado («imagen:5697d8fe»). Si el trozo identifica una
    // sola foto preparada en este mismo ámbito, se acepta; si es ambiguo o no existe, sigue el error.
    const home = await this.home(root)
    const prefix = `location-${digest(await realpath(root))}-`
    const matches = new Set<string>()
    for (const file of (await readdir(home)).filter((name) => name.startsWith(prefix))) {
      const location = (await this.read(join(home, file), 4096)) as Location | null
      if (location?.version === 1 && typeof location.id === 'string' && location.id.toLowerCase().startsWith(id.toLowerCase()))
        matches.add(location.id)
      if (matches.size > 1) return null
    }
    const [only] = matches
    return only ? this.find(root, `id:${only}`) : null
  }
  findPath(root: string, path: string): Promise<RegisteredPhoto | null> {
    return this.find(root, `path:${path.toLowerCase()}`)
  }
}
