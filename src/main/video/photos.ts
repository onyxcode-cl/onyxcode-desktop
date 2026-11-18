/** Reuses scope-bound photo authority; permissive video records never authorize documents. */
import type { FreeImageRegistry } from '../documents/free-image-registry'

export async function resolveVideoPhoto(registry: FreeImageRegistry, root: string, origin: string): Promise<Buffer | null> {
  const id = origin.replace(/^imagen:/, '')
  const photo =
    (await registry.findId(root, id, 'video')) ??
    (await registry.findPath(root, origin, 'video')) ??
    (await registry.findId(root, id)) ??
    (await registry.findPath(root, origin))
  return photo?.asset.bytes ?? null
}
