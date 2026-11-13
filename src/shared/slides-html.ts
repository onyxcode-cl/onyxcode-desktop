import { MAX_SLIDES } from './chat-doc-spec'

export class SlidesHtmlError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SlidesHtmlError'
  }
}

export const SLIDE_CSS_WIDTH = 960
export const SLIDE_CSS_HEIGHT = 540
export const SLIDE_PNG_WIDTH = 3840
export const SLIDE_PNG_HEIGHT = 2160
export const MAX_ARTIFACT_HTML_BYTES = 24 * 1024 * 1024
export const MAX_HTML_BYTES = MAX_ARTIFACT_HTML_BYTES

/** Sólo identifica candidatos; la comprobación autoritativa ocurre en Chromium, con CSS calculado. */
export function hasHtmlSlides(html: string): boolean {
  const tokens =
    /<!--[\s\S]*?(?:-->|$)|<(script|style|textarea|title)\b(?:"[^"]*"|'[^']*'|[^'">])*?>[\s\S]*?(?:<\/\1\s*>|$)|<(?:"[^"]*"|'[^']*'|[^'">])*>/gi
  for (const match of html.matchAll(tokens)) {
    const tag = match[0]
    if (!/^<[a-z]/i.test(tag) || /^<(?:script|style|textarea|title)\b/i.test(tag)) continue
    for (const attr of tag.matchAll(/\s+([^\s=/>]+)(?:\s*=\s*("[^"]*"|'[^']*'|[^\s>]+))?/g)) {
      if (attr[1].toLowerCase() !== 'class') continue
      const raw = attr[2] ?? ''
      const classes = (/^["']/.test(raw) ? raw.slice(1, -1) : raw)
        .replace(/&#(?:x([a-f0-9]+)|(\d+));?/gi, (_entity, hex: string, decimal: string) => {
          const code = parseInt(hex ?? decimal, hex ? 16 : 10)
          return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '\ufffd'
        })
        .replace(/&Tab;/g, '\t')
        .replace(/&NewLine;/g, '\n')
      if (classes.split(/[ \t\r\n\f]+/).includes('slide')) return true
      break // El navegador conserva el primer atributo class.
    }
  }
  return false
}

/** Se ejecuta con medio `print`: la vista de lectura puede añadir separación entre láminas. */
export const VALIDATE_SLIDES_SCRIPT = `(() => {
  const slides = [...document.querySelectorAll('.slide')];
  const fail = detail => { throw new Error('Presentación HTML inválida: ' + detail); };
  if (document.documentElement.dataset.lzxPhotoError) fail(document.documentElement.dataset.lzxPhotoError);
  if (!slides.length) fail('falta al menos un elemento .slide.');
  if (slides.length > ${MAX_SLIDES}) fail('supera el máximo de ${MAX_SLIDES} láminas; no se recortará la presentación.');
  for (const [i, slide] of slides.entries()) {
    const css = getComputedStyle(slide);
    const label = 'lámina ' + (i + 1) + ': ';
    if (slide.parentElement.closest('.slide')) fail(label + 'no se permiten láminas anidadas.');
    if (css.width !== '${SLIDE_CSS_WIDTH}px' || css.height !== '${SLIDE_CSS_HEIGHT}px') fail(label + 'debe medir 960×540 CSS; mide ' + css.width + ' × ' + css.height + '.');
    if (css.display === 'none') fail(label + 'está oculta al imprimir.');
    if (css.boxSizing !== 'border-box') fail(label + 'requiere box-sizing: border-box.');
    if (['marginTop','marginRight','marginBottom','marginLeft'].some(k => parseFloat(css[k]) !== 0)) fail(label + 'requiere márgenes cero al imprimir.');
    if (i < slides.length - 1 && !['page','always'].includes(css.breakAfter) && css.pageBreakAfter !== 'always') fail(label + 'requiere break-after: page para imprimir una lámina por página.');
  }
  if (['marginTop','marginRight','marginBottom','marginLeft'].some(k => parseFloat(getComputedStyle(document.body)[k]) !== 0)) fail('el body requiere márgenes cero.');
  return slides.length;
})()`

/** La misma geometría impresa para Chat, Código y Tareas; evita una página extra al final. */
export const SLIDES_PRINT_STYLE = `@page{size:960px 540px;margin:0}@media print{html,body{margin:0!important;padding:0!important}.slide{break-inside:avoid!important;page-break-inside:avoid!important;break-after:page!important;page-break-after:always!important}.slide[data-lzx-last-slide]{break-after:auto!important;page-break-after:auto!important}}`

/** No hay pausas arbitrarias: errores de imagen/fuente se propagan y el caller impone el plazo. */
export const WAIT_SLIDES_ASSETS_SCRIPT = `(async () => {
  const style = document.createElement('style');
  style.textContent = '*,:before,:after{animation:none!important;transition:none!important;caret-color:transparent!important}';
  document.head.appendChild(style);
  if (document.fonts) await document.fonts.ready;
  const images = [...document.images];
  const urls = new Set();
  for (const el of document.querySelectorAll('*')) {
    for (const pseudo of [null, '::before', '::after']) {
      const css = getComputedStyle(el, pseudo);
      for (const property of ['backgroundImage','borderImageSource','listStyleImage','maskImage','content']) {
        for (const match of (css[property] || '').matchAll(/url\\(\\s*(?:"([^"]*)"|'([^']*)'|([^)]*?))\\s*\\)/g)) urls.add(match[1] || match[2] || match[3]);
      }
    }
  }
  for (const url of urls) { const img = new Image(); img.src = url; images.push(img); }
  await Promise.all(images.map(async img => {
    img.loading = 'eager';
    try { await img.decode(); } catch { throw new Error('No se pudo cargar una foto de la presentación. Prepare e incruste la foto antes de exportar.'); }
    if (!img.naturalWidth || !img.naturalHeight) throw new Error('La presentación contiene una foto vacía.');
  }));
  return true;
})()`
