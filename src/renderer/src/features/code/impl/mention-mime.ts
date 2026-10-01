/** MIME de un archivo mencionado con `@archivo` (por extensión). Lo que no se reconoce se trata como texto. */
const MIME_BY_EXT: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  avif: 'image/avif',
  heic: 'image/heic',
  pdf: 'application/pdf'
}

export function mentionMime(path: string): string {
  const name = path.split(/[/\\]/).pop() ?? path
  const dot = name.lastIndexOf('.')
  if (dot <= 0) return 'text/plain'
  return MIME_BY_EXT[name.slice(dot + 1).toLowerCase()] ?? 'text/plain'
}
