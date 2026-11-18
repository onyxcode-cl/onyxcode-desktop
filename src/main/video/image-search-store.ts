/** Claves solo en main, cifradas; el renderer recibe únicamente presencia y proveedor. */
import { randomUUID } from 'node:crypto'
import { constants, closeSync, fstatSync, lstatSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { SafeStorageLike } from '../remote/devices-store'
import type { VideoImageProvider, VideoImageSearchStatus } from '@shared/video'

export interface ImageSearchConfig {
  provider: VideoImageProvider
  keys: Partial<Record<VideoImageProvider, string>>
}
export class ImageSearchStore {
  constructor(
    private readonly directory: string,
    private readonly safe: SafeStorageLike
  ) {}
  private file(): string {
    return join(this.directory, 'video-image-search.bin')
  }
  read(): ImageSearchConfig {
    try {
      if (!this.safe.isEncryptionAvailable()) return { provider: 'serper', keys: {} }
      const fd = openSync(this.file(), constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
      try {
        const st = fstatSync(fd)
        if (!st.isFile() || st.nlink !== 1 || st.size > 16384 || lstatSync(this.file()).isSymbolicLink()) throw Error('invalid')
        const raw = JSON.parse(this.safe.decryptString(readFileSync(fd))) as ImageSearchConfig
        if (!['serper', 'brave'].includes(raw.provider) || !raw.keys || typeof raw.keys !== 'object') throw Error('invalid')
        const keys: ImageSearchConfig['keys'] = {}
        for (const p of ['serper', 'brave'] as const)
          if (typeof raw.keys[p] === 'string' && /^[\x21-\x7e]{1,512}$/.test(raw.keys[p]!)) keys[p] = raw.keys[p]
        return { provider: raw.provider, keys }
      } finally {
        closeSync(fd)
      }
    } catch {
      return { provider: 'serper', keys: {} }
    }
  }
  status(): VideoImageSearchStatus {
    const c = this.read()
    return {
      provider: c.provider,
      configured: { serper: !!c.keys.serper, brave: !!c.keys.brave },
      secure: this.safe.isEncryptionAvailable()
    }
  }
  save(provider: VideoImageProvider, key?: string): void {
    if (!['serper', 'brave'].includes(provider) || (key !== undefined && key !== '' && !/^[\x21-\x7e]{1,512}$/.test(key)))
      throw Error('Configuración de búsqueda inválida.')
    if (!this.safe.isEncryptionAvailable()) throw Error('Almacén seguro no disponible.')
    const c = this.read()
    c.provider = provider
    if (key !== undefined) {
      if (key) c.keys[provider] = key
      else delete c.keys[provider]
    }
    const encrypted = this.safe.encryptString(JSON.stringify(c))
    mkdirSync(this.directory, { recursive: true, mode: 0o700 })
    const temp = join(this.directory, `.video-image-${randomUUID()}.tmp`)
    try {
      writeFileSync(temp, encrypted, { flag: 'wx', mode: 0o600 })
      renameSync(temp, this.file())
    } finally {
      rmSync(temp, { force: true })
    }
  }
}
