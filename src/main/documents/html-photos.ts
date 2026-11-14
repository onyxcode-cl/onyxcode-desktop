/** Autonomous slide photos: only the persistent, scope-bound image registry is authority. */
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import type { FreeImageAsset } from './free-images'
import type { FreeImageRegistry } from './free-image-registry'
import { htmlHasFreeImagePreview, isFreeImagePreview } from './free-image-preview'
import { htmlImageTags, decodeHtmlText } from './html-images'
import { readTaskFile, relativeInputPath } from './input-path'
import { OutputPathError } from './output-path'
import { MAX_ARTIFACT_HTML_BYTES, hasHtmlSlides } from '@shared/slides-html'
import { t } from '@shared/i18n'

const MAX_PHOTOS = 10
/** A scoped missing reference is actionable, unlike a generic invalid-document error. */
export class MissingPreparedPhotoError extends OutputPathError {
  constructor(reference: string) {
    super('name', t('chat.doc.problem.photoMissingDetail', { reference: reference.slice(0, 200) }))
  }
}
export interface HtmlPhotoScope {
  root: string
  agentRoots?: string[]
  /** Directory of the authorized HTML, relative to root (registry authority remains root). */
  baseDir?: string
}

export async function resolvePreparedHtml(html: string, scope?: HtmlPhotoScope, registry?: FreeImageRegistry): Promise<string> {
  if (Buffer.byteLength(html) > MAX_ARTIFACT_HTML_BYTES) throw new OutputPathError('name', 'El HTML supera el presupuesto de 24 MiB.')
  // Se detectan las vistas previas por la imagen, no por el texto: el HTML autónomo lleva la procedencia
  // en JSON y el modelo puede mencionar ahí la marca de la vista previa sin que haya ninguna incrustada.
  if (htmlHasFreeImagePreview(html))
    throw new OutputPathError('name', 'MUESTRA NO USAR: prepara la foto con imagenes_usar antes de incorporarla.')
  const slides = hasHtmlSlides(html)
  const references = new Set<string>()
  for (const image of htmlImageTags(html)) if (image.source) references.add(image.source)
  for (const match of cssParts(html)
    .join('\n')
    .matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^\s)]*))\s*\)/gi))
    references.add(decodeHtmlText(match[1] ?? match[2] ?? match[3]))
  const assets = new Map<
    string,
    {
      data: string
      credit: string
      provenance: FreeImageAsset['provenance']
    }
  >()
  const refs = new Map<string, string>()
  let bytes = Buffer.byteLength(html)
  for (const ref of references) {
    if (/^(?:data:|blob:|#)/i.test(ref)) continue
    if (!slides && /^(?:https?:|\/\/)/i.test(ref)) continue
    if (/^(?:https?:|\/\/|file:)/i.test(ref))
      throw new OutputPathError('name', 'Las presentaciones no admiten URLs de imágenes: usa imagenes_usar y su identificador.')
    if (!slides) throw new OutputPathError('name', 'Las fotos preparadas para HTML requieren una presentación con elementos .slide.')
    if (!scope || !registry)
      throw new OutputPathError('name', 'Falta el contexto de la conversación o carpeta para validar la foto preparada.')
    const id = ref.startsWith('imagen:') ? ref.slice(7) : null
    const absolute = /^[\\/]|^[A-Za-z]:/.test(ref)
    const parts = id === null ? relativeInputPath(ref, scope.agentRoots ?? [scope.root]) : []
    const base = scope.baseDir && !absolute ? relativeInputPath(scope.baseDir) : []
    const rel = id === null ? [...base, ...parts].join('/') : null
    let record = id !== null ? await registry.findId(scope.root, id) : await registry.findPath(scope.root, rel!)
    // A prepared photo in the HTML's own authorized subdirectory retains its original registry scope.
    let fileRel = record?.rel
    if (!record && base.length) {
      const localRoot = join(scope.root, ...base)
      record = id === null ? await registry.findPath(localRoot, parts.join('/')) : await registry.findId(localRoot, id)
      if (record) fileRel = [...base, record.rel].join('/')
    }
    if (!record) throw new MissingPreparedPhotoError(ref)
    // Even IDs must still point at the intact prepared file; the exported JSON is never authority.
    const file = await readTaskFile(scope.root, fileRel!, scope.agentRoots ?? [scope.root], {}, 'image')
    const sha = createHash('sha256').update(file.bytes).digest('hex')
    if (sha !== record.sha || isFreeImagePreview(file.bytes))
      throw new OutputPathError('name', 'La foto preparada cambió o es una muestra. Vuelve a usar imagenes_usar.')
    refs.set(ref, sha)
    if (assets.has(sha)) continue
    if (assets.size >= MAX_PHOTOS) throw new OutputPathError('name', 'La presentación admite hasta 10 fotos distintas.')
    bytes +=
      Math.ceil((file.bytes.length * 4) / 3) +
      Buffer.byteLength(JSON.stringify(record.asset.provenance)) +
      Buffer.byteLength(record.asset.credit) +
      8192
    if (bytes > MAX_ARTIFACT_HTML_BYTES)
      throw new OutputPathError(
        'name',
        'Las fotos incrustadas superan el presupuesto de 24 MiB. Usa menos fotos o prepáralas con menor peso.'
      )
    assets.set(sha, {
      data: `data:image/jpeg;base64,${file.bytes.toString('base64')}`,
      credit: record.asset.credit,
      provenance: record.asset.provenance
    })
  }
  if (!assets.size) return html
  assertImagesInsideSlides(html, refs)

  for (const image of htmlImageTags(html).reverse()) {
    const sha = refs.get(image.source)
    if (!sha) continue
    const tag =
      image.tag.slice(0, image.valueStart) +
      '""' +
      image.tag.slice(image.valueEnd).replace(/\s*\/?>$/, (end) => ` data-lzx-photo="${sha}"${end}`)
    html = html.slice(0, image.start) + tag + html.slice(image.end)
  }
  html = mapCss(html, (css) =>
    css.replace(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^\s)]*))\s*\)/gi, (whole, a: string, b: string, c: string) => {
      const sha = refs.get(decodeHtmlText(a ?? b ?? c))
      return sha ? `var(--lzx-photo-${sha})` : whole
    })
  )
  const data = JSON.stringify(Object.fromEntries([...assets].map(([sha, { data }]) => [sha, data]))).replace(/</g, '\\u003c')
  // A single copy of each data URI supplies every occurrence, including CSS backgrounds.
  // Photo provenance stays invisible; authored text, links and layout are left untouched.
  const script = `<script data-lzx-prepared-photos>(function(){const photos=${data};
const root=document.documentElement;
for(const [id,data] of Object.entries(photos)){root.style.setProperty('--lzx-photo-'+id,'url("'+data+'")')}
const check=el=>{if(!el.closest('.slide'))root.dataset.lzxPhotoError='La foto preparada debe estar dentro de una .slide'};
document.querySelectorAll('[data-lzx-photo]').forEach(el=>{const id=el.getAttribute('data-lzx-photo');
if(photos[id]){el.src=photos[id];check(el)}});
const checkStyle=(el,text)=>{if(Object.keys(photos).some(id=>text.includes('--lzx-photo-'+id)))check(el)};
const rules=list=>{for(const rule of list){if(rule.cssRules)rules(rule.cssRules);
if(rule.selectorText&&rule.style){try{document.querySelectorAll(rule.selectorText.replace(/::(?:before|after)/g,'')).forEach(el=>checkStyle(el,rule.style.cssText))}catch{}}}};
for(const sheet of document.styleSheets){try{rules(sheet.cssRules)}catch{}}
})();</script>`
  const metadata = `<script type="application/json" data-lzx-photo-provenance>${JSON.stringify([...assets].map(([sha, p]) => ({ sha, credit: p.credit, provenance: p.provenance }))).replace(/</g, '\\u003c')}</script>`
  const addition = `${metadata}${script}`
  html = /<\/body\s*>/i.test(html) ? html.replace(/<\/body\s*>/i, () => addition + '</body>') : html + addition
  if (Buffer.byteLength(html) > MAX_ARTIFACT_HTML_BYTES)
    throw new OutputPathError('name', 'El HTML con sus fotos supera el presupuesto de 24 MiB.')
  return html
}

/** Only actual CSS containers; JavaScript strings and visible prose are not resource requests. */
function mapCss(html: string, map: (css: string) => string): string {
  return html.replace(
    /<!--[\s\S]*?-->|<(script|textarea|title)\b[^>]*>[\s\S]*?<\/\1\s*>|<style\b[^>]*>[\s\S]*?<\/style\s*>|<(?:"[^"]*"|'[^']*'|[^'">])*>/gi,
    (tag) => {
      if (/^<style\b/i.test(tag))
        return tag.replace(/(>)([\s\S]*)(<\/style\s*>)/i, (_: string, a: string, css: string, b: string) => a + map(css) + b)
      if (/^<!--|^<(?:script|textarea|title)\b/i.test(tag)) return tag
      return tag.replace(
        /(\sstyle\s*=\s*)("[^"]*"|'[^']*')/gi,
        (_: string, prefix: string, value: string) =>
          prefix +
          value[0] +
          map(decodeHtmlText(value.slice(1, -1)))
            .replace(/&/g, '&amp;')
            .replace(value[0] === '"' ? /"/g : /'/g, value[0] === '"' ? '&quot;' : '&#39;') +
          value[0]
      )
    }
  )
}
function cssParts(html: string): string[] {
  const parts: string[] = []
  mapCss(html, (css) => {
    parts.push(css)
    return css
  })
  return parts
}

export function hasPreparedPhotoReferences(html: string): boolean {
  return htmlImageTags(html).some((image) => image.source.startsWith('imagen:')) || cssParts(html).some((css) => /imagen:/i.test(css))
}

function assertImagesInsideSlides(html: string, refs: Map<string, string>): void {
  const prepared = new Set(
    htmlImageTags(html)
      .filter((image) => refs.has(image.source))
      .map((image) => image.start)
  )
  const stack: Array<{ tag: string; slide: boolean }> = []
  const tokens =
    /<!--[\s\S]*?-->|<(script|style|textarea|title)\b(?:"[^"]*"|'[^']*'|[^'">])*?>[\s\S]*?(?:<\/\1\s*>|$)|<(?:"[^"]*"|'[^']*'|[^'">])*>/gi
  for (const match of html.matchAll(tokens)) {
    const tag = match[0]
    if (/^<!--|^<(?:script|style|textarea|title)\b/i.test(tag)) continue
    const closing = /^<\/([a-z][\w:-]*)/i.exec(tag)
    if (closing) {
      const i = stack.map((entry) => entry.tag).lastIndexOf(closing[1].toLowerCase())
      if (i >= 0) stack.splice(i)
      continue
    }
    if (prepared.has(match.index!) && !stack.some((entry) => entry.slide))
      throw new OutputPathError('name', 'Cada foto preparada debe estar dentro de su misma lámina .slide.')
    const opening = /^<([a-z][\w:-]*)/i.exec(tag)
    if (!opening || /\/\s*>$/.test(tag) || /^(?:img|input|meta|link|br|hr|source|area|base|col|embed|param|track|wbr)$/i.test(opening[1]))
      continue
    stack.push({ tag: opening[1].toLowerCase(), slide: hasHtmlSlides(tag) })
  }
}
