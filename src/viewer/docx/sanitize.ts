/**
 * Segunda capa de defensa sobre lo que renderiza `docx-preview` (Fase 2 del plan del visor): la
 * primera es la CSP del propio visor (`default-src 'none'`, sin red saliente salvo el propio
 * esquema). Esta corre DESPUÉS del render, sobre el DOM real, y asume que el documento es hostil:
 * un docx puede traer un hipervínculo `javascript:`, una imagen con `TargetMode="External"` a una
 * IP local, o un `<style>` con `url(http://…)` de fondo. Nada de eso debe quedar vivo en el DOM.
 */
const URL_ATTRS = ['src', 'poster', 'srcset', 'background', 'action', 'formaction']
const LINK_ATTRS = ['href', 'xlink:href']
const DEAD_TAGS = ['script', 'iframe', 'object', 'embed', 'link', 'meta', 'form']

function isSafeUrl(value: string): boolean {
  const v = value.trim().toLowerCase()
  return v === '' || v.startsWith('data:') || v.startsWith('#')
}

function stripUrlFunctions(css: string): string {
  return css.replace(/url\(\s*(['"]?)(.*?)\1\s*\)/gi, (whole, _q, inner: string) => (isSafeUrl(inner) ? whole : 'url()'))
}

/** Saca del DOM (ya renderizado) todo lo que pudiera alcanzar red o ejecutar código. Idempotente. */
export function sanitizeDocxDom(root: ParentNode & Element): void {
  for (const tag of DEAD_TAGS) for (const el of Array.from(root.querySelectorAll(tag))) el.remove()

  // Todo enlace queda inerte, aunque apunte a algo "inofensivo": este visor no navega a ningún lado.
  for (const link of LINK_ATTRS) for (const el of Array.from(root.querySelectorAll(`[${link}]`))) el.removeAttribute(link)

  for (const el of Array.from(root.querySelectorAll('*'))) {
    for (const attr of Array.from(el.attributes)) {
      if (attr.name.toLowerCase().startsWith('on')) {
        el.removeAttribute(attr.name)
        continue
      }
      if (URL_ATTRS.includes(attr.name.toLowerCase()) && !isSafeUrl(attr.value)) el.removeAttribute(attr.name)
    }
    const style = el.getAttribute('style')
    if (style && style.includes('url(')) el.setAttribute('style', stripUrlFunctions(style))
  }

  for (const styleTag of Array.from(root.querySelectorAll('style'))) styleTag.textContent = stripUrlFunctions(styleTag.textContent ?? '')
}
