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

/** Normaliza decks comunes en un viewport 16:9; conserva su lienzo y escala el conjunto.
 * Debe ejecutarse con medio screen y viewport 960×540 antes de imprimir/capturar.
 * La app añade paginación, márgenes y visibilidad: no se exige que el modelo los acierte.
 */
export const VALIDATE_SLIDES_SCRIPT = `(() => {
  const freeze = document.createElement('style');
  freeze.textContent = '*,:before,:after{animation:none!important;transition:none!important;caret-color:transparent!important}';
  document.head.appendChild(freeze);
  const slides = [...document.querySelectorAll('.slide')];
  const fail = detail => { throw new Error('Presentación HTML inválida: ' + detail); };
  if (document.documentElement.dataset.lzxPhotoError) fail(document.documentElement.dataset.lzxPhotoError);
  if (!slides.length) fail('falta al menos un elemento .slide.');
  if (slides.length > ${MAX_SLIDES}) fail('supera el máximo de ${MAX_SLIDES} láminas; no se recortará la presentación.');
  const preferredDisplay = slides.map(el => getComputedStyle(el).display).find(value => value && value !== 'none') || 'block';
  const px = (value, axis) => value.endsWith('vw') ? parseFloat(value) * innerWidth / 100 : value.endsWith('vh') ? parseFloat(value) * innerHeight / 100 : value.endsWith('%') ? parseFloat(value) * axis / 100 : parseFloat(value);
  for (const [i, slide] of slides.entries()) {
    const label = 'lámina ' + (i + 1) + ': ';
    if (slide.parentElement.closest('.slide')) fail(label + 'no se permiten láminas anidadas.');
    if (getComputedStyle(slide).display === 'none') slide.style.setProperty('display', preferredDisplay, 'important');
    slide.style.setProperty('zoom','1','important');
    slide.style.setProperty('transform','none','important');
    const css = getComputedStyle(slide);
    let width = px(css.width, innerWidth), height = px(css.height, innerHeight);
    const bounds = slide.getBoundingClientRect();
    if (!Number.isFinite(width)) width = bounds.width;
    if (!Number.isFinite(height)) height = bounds.height;
    if (css.boxSizing !== 'border-box' && Number.isFinite(px(css.width, innerWidth)) && Number.isFinite(px(css.height, innerHeight))) {
      width += ['paddingLeft','paddingRight','borderLeftWidth','borderRightWidth'].reduce((sum, key) => sum + (parseFloat(css[key]) || 0), 0);
      height += ['paddingTop','paddingBottom','borderTopWidth','borderBottomWidth'].reduce((sum, key) => sum + (parseFloat(css[key]) || 0), 0);
    }
    if (!(width > 0 && height > 0 && Number.isFinite(width) && Number.isFinite(height))) fail(label + 'no se pudo determinar un tamaño positivo; use dimensiones CSS o aspect-ratio:16/9.');
    if (Math.abs(width / height - 16 / 9) > .03) fail(label + 'debe tener proporción 16:9; mide ' + width + ' × ' + height + '.');
    // Redondeos de píxeles son comunes con aspect-ratio y porcentajes.
    const scale = ${SLIDE_CSS_WIDTH} / width;
    slide.dataset.lzxExportDisplay = css.display;
    slide.dataset.lzxExportScale = String(scale);
    slide.style.setProperty('box-sizing','border-box','important');
    slide.style.setProperty('width', width + 'px','important');
    slide.style.setProperty('height', (width * 9 / 16) + 'px','important');
    slide.style.setProperty('min-width','0','important'); slide.style.setProperty('min-height','0','important');
    slide.style.setProperty('max-width','none','important'); slide.style.setProperty('max-height','none','important');
    slide.style.setProperty('margin','0','important'); slide.style.setProperty('zoom',String(scale),'important');
    slide.style.setProperty('position','relative','important');
    slide.style.setProperty('inset','auto','important');
    slide.style.setProperty('visibility','visible','important'); slide.style.setProperty('opacity','1','important');
    slide.style.setProperty('flex-shrink','0','important');
  }
  // Los ancestros pueden ser un carrusel flex con transform o un contenedor a pantalla completa.
  for (const el of document.body.querySelectorAll('*')) {
    if (el.closest('.slide')) continue;
    if (!el.querySelector('.slide')) el.style.setProperty('display','none','important');
    else for (const [key,value] of Object.entries({display:'block',position:'static',transform:'none',zoom:'1',width:'auto',height:'auto','min-height':'0','max-height':'none',overflow:'visible',margin:'0',padding:'0',gap:'0'})) el.style.setProperty(key,value,'important');
  }
  document.documentElement.style.cssText += ';margin:0!important;padding:0!important;overflow:visible!important';
  document.body.style.cssText += ';margin:0!important;padding:0!important;display:block!important;overflow:visible!important;width:960px!important;height:auto!important;transform:none!important;zoom:1!important';
  const style = document.createElement('style');
  style.textContent = '@page{size:960px 540px;margin:0}.slide{break-inside:avoid!important;page-break-inside:avoid!important;break-after:page!important;page-break-after:always!important}.slide[data-lzx-last-slide]{break-after:auto!important;page-break-after:auto!important}';
  document.head.appendChild(style);
  slides[slides.length - 1].setAttribute('data-lzx-last-slide','');
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
