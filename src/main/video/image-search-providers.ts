/** Adaptadores a las APIs publicadas de cada proveedor. Sin páginas de resultados ni endpoints arbitrarios. */
import type { VideoImageProvider } from '@shared/video'
import { boundedJson } from '../util/bounded-json'
import { publicHttpsUrl } from '../util/public-https'

export interface WebImageResult {
  title: string
  source: string
  url: string
  thumb: string
  width: number
  height: number
}
export async function searchWebImages(
  provider: VideoImageProvider,
  key: string,
  query: string,
  signal: AbortSignal,
  fetchImpl: typeof fetch = fetch
): Promise<WebImageResult[]> {
  const brave = provider === 'brave'
  const endpoint = brave
    ? `https://api.search.brave.com/res/v1/images/search?${new URLSearchParams({ q: query, count: '20', safesearch: 'strict' })}`
    : 'https://google.serper.dev/images'
  const data = (await boundedJson(
    endpoint,
    brave
      ? { headers: { 'X-Subscription-Token': key } }
      : { method: 'POST', headers: { 'X-API-KEY': key, 'Content-Type': 'application/json' }, body: JSON.stringify({ q: query, num: 20 }) },
    signal,
    fetchImpl
  )) as Record<string, unknown>
  const values = data?.[brave ? 'results' : 'images']
  if (!Array.isArray(values)) throw Error('El buscador devolvió una respuesta no válida.')
  const results: WebImageResult[] = []
  for (const value of values.slice(0, 20)) {
    if (!value || typeof value !== 'object') continue
    try {
      const item = value as Record<string, unknown>
      const props = (item.properties ?? {}) as Record<string, unknown>
      const thumbnail = (item.thumbnail ?? {}) as Record<string, unknown>
      const width = Number(brave ? props.width : item.imageWidth),
        height = Number(brave ? props.height : item.imageHeight)
      if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0 || width * height > 40_000_000) continue
      results.push({
        title: String(item.title ?? '')
          .replace(/<[^>]*>/g, '')
          .slice(0, 400),
        source: publicHttpsUrl(String(brave ? item.url : item.link)).href,
        url: publicHttpsUrl(String(brave ? props.url : item.imageUrl)).href,
        thumb: publicHttpsUrl(String(brave ? thumbnail.src : item.thumbnailUrl)).href,
        width,
        height
      })
    } catch {
      /* Enlaces que no pueden descargarse de forma segura no son candidatas. */
    }
  }
  return results
}
