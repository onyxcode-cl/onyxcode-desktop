/** Helpers puros del worker. Solo consumen datos del paquete fijado y resultados del muestreo. */
export const FONT_NAMES = ['Inter', 'Montserrat', 'Outfit', 'Nunito', 'Oswald', 'League Gothic', 'Archivo Black', 'Space Mono', 'IBM Plex Mono', 'JetBrains Mono', 'EB Garamond', 'Playfair Display', 'Source Code Pro', 'Noto Sans JP', 'Roboto', 'Open Sans', 'Lato', 'Poppins']
export function embeddedFonts(data, base) {
  const files = new Map()
  const css = []
  for (const [key, url] of data) {
    const match = /^@fontsource\/([a-z-]+):(\d+):normal$/.exec(key)
    if (!match) continue
    const [, slug, weight] = match
    const family = FONT_NAMES.find((name) => name.toLowerCase().replaceAll(' ', '-') === slug)
    if (!family || !/^data:font\/woff2;base64,[A-Za-z0-9+/=]+$/.test(url)) continue
    const name = `${slug}-${weight}.woff2`
    files.set(name, Buffer.from(url.split(',')[1], 'base64'))
    css.push(`@font-face{font-family:"${family}";font-weight:${weight};font-style:normal;src:url("${base}${name}") format("woff2");font-display:block}`)
  }
  if (files.size !== 42) throw Error('El paquete fijado no contiene las 42 fuentes esperadas.')
  return { files, css: css.join('\n') }
}
export function groupWarnings(findings) {
  const groups = new Map()
  for (const finding of findings) {
    const message = String(finding.message).replace(/[\x00-\x1f\x7f]/g, ' ').slice(0, 320)
    const selector = String(finding.selector ?? '').slice(0, 180)
    const key = `${finding.code ?? ''}|${selector}|${message.replace(/ocupa solo el \d+ %/, 'ocupa poco')}`
    const entry = groups.get(key) ?? { message, selector, times: [] }
    if (Number.isFinite(finding.time)) entry.times.push(finding.time)
    groups.set(key, entry)
  }
  return [...groups.values()].slice(0, 80).map(({ message, selector, times }) => {
    const sorted = [...new Set(times)].sort((a, b) => a - b)
    const label = (n) => Number(n.toFixed(2))
    const span = sorted.length ? `${label(sorted[0])}${sorted.length > 1 ? `–${label(sorted.at(-1))}` : ''} s: ` : ''
    return `${span}${message}${selector ? ` [${selector}]` : ''}`
  })
}
/** Filtro sin rutas ni expresiones del autor; todos los números ya están comprobados. */
export function audioFilter(tracks, seconds) {
  const chains = tracks.map((t, i) => {
    const filters = [`atrim=start=${t.desde}:duration=${t.duration}`, 'asetpts=PTS-STARTPTS']
    let rate = t.rate ?? 1
    while (rate > 2) { filters.push('atempo=2'); rate /= 2 }
    while (rate < 0.5) { filters.push('atempo=0.5'); rate /= 0.5 }
    if (rate !== 1) filters.push(`atempo=${rate}`)
    filters.push(`volume=${t.volumen}`)
    const played = t.duration / (t.rate ?? 1)
    if (t.fundidoEntrada) filters.push(`afade=t=in:st=0:d=${Math.min(t.fundidoEntrada, played)}`)
    if (t.fundidoSalida) filters.push(`afade=t=out:st=${Math.max(0, played - t.fundidoSalida)}:d=${Math.min(t.fundidoSalida, played)}`)
    filters.push(`adelay=${Math.round(t.inicio * 1000)}:all=1`)
    return `[${i + 1}:a]${filters.join(',')}[a${i}]`
  })
  chains.push(`${tracks.map((_, i) => `[a${i}]`).join('')}amix=inputs=${tracks.length}:duration=longest:normalize=0,alimiter=limit=0.891:level=0,apad,atrim=duration=${seconds}[mix]`)
  return chains.join(';')
}
