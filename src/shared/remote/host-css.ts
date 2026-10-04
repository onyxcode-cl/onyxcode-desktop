/**
 * El CSS ligero se escribe con `:root` y vive en un shadow root, donde `:root` no existe: se pasa a `:host`. Los selectores con
 * atributo necesitan la forma funcional (`:host([data-theme='dark'])`; `:host[...]` no es válido).
 */
export function hostCss(css: string): string {
  return css
    .replace(/:root\[([^\]]+)\]/g, ':host([$1])')
    .replace(/:root:not\(\[([^\]]+)\]\)/g, ':host(:not([$1]))')
    .replace(/:root/g, ':host')
}
