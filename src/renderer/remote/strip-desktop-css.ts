import postcss, { type AtRule, type ChildNode, type Container, type Rule } from 'postcss'

/**
 * Quita de un CSS compilado toda regla cuyo selector use `data-shell` (la variante `desk:` de Tailwind y la capa de escritorio): la
 * PWA del celular nunca marca `<html data-shell>`, así que esas reglas no le sirven y solo pesarían. Quita también los `@media`,
 * `@supports` y `@layer` que quedan vacíos. Es independiente de que el CSS venga minificado o no.
 */
export function stripDesktopCss(css: string): string {
  const root = postcss.parse(css)
  root.walkRules((rule: Rule) => {
    if (!rule.selector.includes('data-shell')) return
    // Selector de lista (`a, b`): solo se descartan los de escritorio; si no queda ninguno, se quita la regla.
    const keep = rule.selectors.filter((s) => !s.includes('data-shell'))
    if (keep.length === 0) rule.remove()
    else rule.selectors = keep
  })
  const prune = (node: Container<ChildNode>): void => {
    node.each((child) => {
      if (child.type !== 'atrule') return
      const at = child as AtRule
      if (!at.nodes) return
      prune(at)
      if (at.nodes.length === 0 && /^(media|supports|layer|container)$/i.test(at.name)) at.remove()
    })
  }
  prune(root)
  return root.toString()
}
