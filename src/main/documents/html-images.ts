/** Tokenización acotada de etiquetas img: no interpreta scripts, estilos, comentarios ni valores de otros atributos. */
export interface HtmlImageTag {
  start: number
  end: number
  tag: string
  source: string
  valueStart: number
  valueEnd: number
}

export function decodeHtmlText(text: string): string {
  return text.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (entity, code: string) => {
    if (code.startsWith('#')) {
      const n = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : Number(code.slice(1))
      return n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : '\ufffd'
    }
    return ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0' } as Record<string, string>)[code.toLowerCase()] ?? entity
  })
}

export function htmlImageTags(html: string): HtmlImageTag[] {
  const result: HtmlImageTag[] = []
  const tokens =
    /<!--[\s\S]*?(?:-->|$)|<(script|style|textarea|title)\b(?:"[^"]*"|'[^']*'|[^'">])*?>[\s\S]*?(?:<\/\1\s*>|$)|<(?:"[^"]*"|'[^']*'|[^'">])*>/gi
  for (const match of html.matchAll(tokens)) {
    const tag = match[0]
    if (!/^<img(?:\s|\/?>)/i.test(tag)) continue
    const attributes = /\s+([^\s=/>]+)(?:\s*=\s*("[^"]*"|'[^']*'|[^\s>]+))?/g
    for (const attr of tag.matchAll(attributes)) {
      if (attr[1].toLowerCase() !== 'src') continue
      if (attr[2] === undefined) break // El navegador usa el primer atributo, incluso vacío.
      const raw = attr[2]
      const source = decodeHtmlText(/^["']/.test(raw) ? raw.slice(1, -1) : raw)
      const valueStart = attr.index! + attr[0].lastIndexOf(raw)
      result.push({ start: match.index!, end: match.index! + tag.length, tag, source, valueStart, valueEnd: valueStart + raw.length })
      break
    }
  }
  return result
}

export function htmlImageSources(html: string): string[] {
  return htmlImageTags(html).map((image) => image.source)
}

export function mapHtmlImageSources(html: string, mapper: (source: string) => string): string {
  for (const image of htmlImageTags(html).reverse()) {
    const value = mapper(image.source)
    if (value === image.source) continue
    const escaped = value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    const tag = image.tag.slice(0, image.valueStart) + `"${escaped}"` + image.tag.slice(image.valueEnd)
    html = html.slice(0, image.start) + tag + html.slice(image.end)
  }
  return html
}
