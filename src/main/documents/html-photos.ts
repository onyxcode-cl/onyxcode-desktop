/** Autonomous slide photos: only the persistent, scope-bound image registry is authority. */
import { createHash } from 'node:crypto'
import type { FreeImageAsset } from './free-images'
import type { FreeImageRegistry } from './free-image-registry'
import { htmlHasFreeImagePreview, isFreeImagePreview } from './free-image-preview'
import { htmlImageTags, decodeHtmlText } from './html-images'
import { readTaskFile, relativeInputPath } from './input-path'
import { OutputPathError } from './output-path'
import { MAX_ARTIFACT_HTML_BYTES, hasHtmlSlides } from '@shared/slides-html'

const MAX_PHOTOS = 10
export interface HtmlPhotoScope {
  root: string
  agentRoots?: string[]
}

export async function resolvePreparedHtml(html: string, scope?: HtmlPhotoScope, registry?: FreeImageRegistry): Promise<string> {
  if (Buffer.byteLength(html) > MAX_ARTIFACT_HTML_BYTES) throw new OutputPathError('name', 'El HTML supera el presupuesto de 24 MiB.')
  if (htmlHasFreeImagePreview(html) || /MUESTRA\s+NO\s+USAR/i.test(html))
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
    { data: string; credit: string; source: string; licenseUrl: string; provenance: FreeImageAsset['provenance'] }
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
    const rel = id === null ? relativeInputPath(ref, scope.agentRoots ?? [scope.root]).join('/') : null
    const record = id !== null ? await registry.findId(scope.root, id) : await registry.findPath(scope.root, rel!)
    if (!record)
      throw new OutputPathError('name', 'La foto no está preparada en esta conversación o carpeta. Usa imagenes_usar en este ámbito.')
    // Even IDs must still point at the intact prepared file; the exported JSON is never authority.
    const file = await readTaskFile(scope.root, record.rel, scope.agentRoots ?? [scope.root], {}, 'image')
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
      source: record.asset.provenance.source,
      licenseUrl: record.asset.provenance.licenseUrl,
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
  const data = JSON.stringify(Object.fromEntries([...assets].map(([sha, { provenance: _provenance, ...photo }]) => [sha, photo]))).replace(
    /</g,
    '\\u003c'
  )
  // A single copy of each data URI supplies every occurrence, including CSS backgrounds.
  // Credits are placed inside the actual closest slide, never in a global print footer.
  const script = `<script data-lzx-prepared-photos>(function(){const photos=${data};
const root=document.documentElement;
const used=new Map();
for(const [id,p] of Object.entries(photos)){root.style.setProperty('--lzx-photo-'+id,'url("'+p.data+'")')}
const mark=(el,id)=>{const slide=el.closest('.slide');
if(!slide){root.dataset.lzxPhotoError='La foto preparada debe estar dentro de una .slide';return;}
if(!used.has(slide))used.set(slide,new Set());used.get(slide).add(id)};
document.querySelectorAll('[data-lzx-photo]').forEach(el=>{const id=el.getAttribute('data-lzx-photo');
if(photos[id]){el.src=photos[id].data;mark(el,id)}});
const markStyle=(el,text)=>{for(const id of Object.keys(photos)){if(text.includes('--lzx-photo-'+id))mark(el,id)}};
const rules=(list)=>{for(const rule of list){if(rule.cssRules)rules(rule.cssRules);
if(rule.selectorText&&rule.style){try{document.querySelectorAll(rule.selectorText.replace(/::(?:before|after)/g,'')).forEach(el=>markStyle(el,rule.style.cssText))}catch{}}}};
for(const sheet of document.styleSheets){try{rules(sheet.cssRules)}catch{}}
document.querySelectorAll('.slide,.slide *').forEach(el=>{markStyle(el,el.style.cssText);
for(const pseudo of [null,'::before','::after']){const bg=getComputedStyle(el,pseudo).backgroundImage;
for(const [id,p] of Object.entries(photos)){if(bg.includes(p.data)||bg.includes('--lzx-photo-'+id))mark(el,id)}}});
for(const [slide,ids] of used){if(getComputedStyle(slide).position==='static')slide.style.position='relative';
const credit=document.createElement('aside');credit.setAttribute('data-lzx-photo-credit','');credit.style.cssText='position:absolute!important;left:16px!important;right:16px!important;bottom:10px!important;z-index:2147483647!important;display:block!important;margin:0!important;padding:5px 8px!important;background:#111!important;color:#fff!important;font:12px/1.3 Arial,sans-serif!important;text-align:left!important;border-radius:3px!important;opacity:1!important;visibility:visible!important;';
for(const id of ids){const p=photos[id];
const line=document.createElement('div');line.textContent=p.credit;
const source=document.createElement('a');source.href=p.source;source.textContent=' · Fuente';source.style.cssText='color:#fff!important;text-decoration:underline!important';line.appendChild(source);const license=document.createElement('a');license.href=p.licenseUrl;license.textContent=' · Licencia';license.style.cssText=source.style.cssText;line.appendChild(license);credit.appendChild(line)}slide.appendChild(credit)}})();</script>`
  const metadata = `<script type="application/json" data-lzx-photo-provenance>${JSON.stringify([...assets].map(([sha, p]) => ({ sha, credit: p.credit, provenance: p.provenance }))).replace(/</g, '\\u003c')}</script>`
  const addition = `${metadata}${script}`
  html = /<\/body\s*>/i.test(html) ? html.replace(/<\/body\s*>/i, () => addition + '</body>') : html + addition
  if (Buffer.byteLength(html) > MAX_ARTIFACT_HTML_BYTES)
    throw new OutputPathError('name', 'El HTML con sus créditos supera el presupuesto de 24 MiB.')
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
