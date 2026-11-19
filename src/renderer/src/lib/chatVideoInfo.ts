/** Metadatos compartidos por ruta: una corrección del MP4 renueva todas sus tarjetas montadas. */
import type { ChatFileInfo } from '@shared/ipc-extras'
const entries = new Map<string, { info: ChatFileInfo; request: number }>()
const listeners = new Set<() => void>()
let request = 0
export const nextVideoInfoRequest = (): number => ++request
export function publishVideoInfo(files: ChatFileInfo[], request: number): void {
  let changed = false
  for (const info of files) {
    if (!/\.mp4$/i.test(info.name) || (entries.get(info.path)?.request ?? -1) > request) continue
    entries.delete(info.path)
    entries.set(info.path, { info, request })
    changed = true
  }
  while (entries.size > 256) entries.delete(entries.keys().next().value!)
  if (changed) for (const listener of listeners) listener()
}
export const getVideoInfo = (path: string): ChatFileInfo | undefined => entries.get(path)?.info
export function subscribeVideoInfo(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
