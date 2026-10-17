/**
 * Lector XML mínimo y a prueba de documentos hostiles para los formatos de oficina. Sin DOM ni red:
 *  - ignora `<!DOCTYPE>` por completo (nada de entidades externas ni «billion laughs»): solo se decodifican las cinco
 *    entidades estándar y las numéricas; cualquier otra queda como texto literal;
 *  - profundidad y cantidad de nodos acotadas (si se pasan, el documento se da por dañado);
 *  - conserva los prefijos (`w:p`, `a:t`…), que es lo que usan los extractores.
 */

export interface XNode {
  name: string
  attrs: Record<string, string>
  children: XNode[]
  /** Solo en nodos de texto (`name === '#text'`). */
  text?: string
}

export class XmlError extends Error {}

const MAX_DEPTH = 256
const MAX_NODES = 4_000_000

const ENTITIES: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" }

export function decodeEntities(s: string): string {
  if (s.indexOf('&') < 0) return s
  return s.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[A-Za-z]+);/g, (m, g: string) => {
    if (g[0] === '#') {
      const code = g[1] === 'x' || g[1] === 'X' ? parseInt(g.slice(2), 16) : parseInt(g.slice(1), 10)
      if (!Number.isFinite(code) || code < 0 || code > 0x10ffff || (code >= 0xd800 && code < 0xe000)) return ''
      return String.fromCodePoint(code)
    }
    return ENTITIES[g] ?? m
  })
}

function parseAttrs(src: string): Record<string, string> {
  const attrs: Record<string, string> = {}
  const re = /([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g
  let m: RegExpExecArray | null
  while ((m = re.exec(src))) attrs[m[1]] = decodeEntities(m[2] ?? m[3] ?? '')
  return attrs
}

/** Devuelve un nodo raíz sintético (`#root`) con los elementos de primer nivel como hijos. */
export function parseXml(xml: string): XNode {
  const root: XNode = { name: '#root', attrs: {}, children: [] }
  const stack: XNode[] = [root]
  let nodes = 0
  let i = 0
  const n = xml.length
  const pushText = (raw: string): void => {
    if (!raw) return
    const top = stack[stack.length - 1]
    top.children.push({ name: '#text', attrs: {}, children: [], text: decodeEntities(raw) })
    if (++nodes > MAX_NODES) throw new XmlError('demasiados nodos')
  }
  while (i < n) {
    const lt = xml.indexOf('<', i)
    if (lt < 0) {
      pushText(xml.slice(i))
      break
    }
    if (lt > i) pushText(xml.slice(i, lt))
    if (xml.startsWith('<!--', lt)) {
      const end = xml.indexOf('-->', lt + 4)
      i = end < 0 ? n : end + 3
    } else if (xml.startsWith('<![CDATA[', lt)) {
      const end = xml.indexOf(']]>', lt + 9)
      const raw = xml.slice(lt + 9, end < 0 ? n : end)
      const top = stack[stack.length - 1]
      if (raw) top.children.push({ name: '#text', attrs: {}, children: [], text: raw })
      i = end < 0 ? n : end + 3
    } else if (xml.startsWith('<?', lt)) {
      const end = xml.indexOf('?>', lt + 2)
      i = end < 0 ? n : end + 2
    } else if (xml.startsWith('<!', lt)) {
      // DOCTYPE (con o sin subconjunto interno entre corchetes): se salta entero.
      let depth = 0
      let j = lt + 2
      for (; j < n; j++) {
        const c = xml[j]
        if (c === '[') depth++
        else if (c === ']') depth = Math.max(0, depth - 1)
        else if (c === '>' && depth === 0) break
      }
      i = j + 1
    } else if (xml[lt + 1] === '/') {
      const end = xml.indexOf('>', lt + 2)
      if (end < 0) throw new XmlError('etiqueta sin cerrar')
      const name = xml.slice(lt + 2, end).trim()
      if (stack.length > 1 && stack[stack.length - 1].name === name) stack.pop()
      else {
        // Cierre que no coincide: se busca hacia arriba; si no existe se ignora.
        for (let k = stack.length - 1; k >= 1; k--) {
          if (stack[k].name === name) {
            stack.length = k
            break
          }
        }
      }
      i = end + 1
    } else {
      // Etiqueta de apertura: se busca el `>` respetando comillas en atributos.
      let j = lt + 1
      let quote = ''
      for (; j < n; j++) {
        const c = xml[j]
        if (quote) {
          if (c === quote) quote = ''
        } else if (c === '"' || c === "'") quote = c
        else if (c === '>') break
      }
      if (j >= n) throw new XmlError('etiqueta sin cerrar')
      let inner = xml.slice(lt + 1, j)
      const selfClose = inner.endsWith('/')
      if (selfClose) inner = inner.slice(0, -1)
      const sp = inner.search(/\s/)
      const name = sp < 0 ? inner : inner.slice(0, sp)
      if (!name) throw new XmlError('etiqueta sin nombre')
      const node: XNode = { name, attrs: sp < 0 ? {} : parseAttrs(inner.slice(sp)), children: [] }
      if (++nodes > MAX_NODES) throw new XmlError('demasiados nodos')
      stack[stack.length - 1].children.push(node)
      if (!selfClose) {
        if (stack.length >= MAX_DEPTH) throw new XmlError('anidado demasiado profundo')
        stack.push(node)
      }
      i = j + 1
    }
  }
  return root
}

/** Primer hijo directo con ese nombre. */
export function child(node: XNode | undefined, name: string): XNode | undefined {
  return node?.children.find((c) => c.name === name)
}

/** Hijos directos con ese nombre. */
export function childrenOf(node: XNode | undefined, name: string): XNode[] {
  return node ? node.children.filter((c) => c.name === name) : []
}

/** Primer descendiente (en orden de documento) con ese nombre. */
export function findDeep(node: XNode | undefined, name: string): XNode | undefined {
  if (!node) return undefined
  const stack: XNode[] = [...node.children].reverse()
  while (stack.length) {
    const cur = stack.pop() as XNode
    if (cur.name === name) return cur
    for (let k = cur.children.length - 1; k >= 0; k--) stack.push(cur.children[k])
  }
  return undefined
}

/** Todos los descendientes con ese nombre, en orden de documento. */
export function findAllDeep(node: XNode | undefined, name: string): XNode[] {
  const out: XNode[] = []
  if (!node) return out
  const stack: XNode[] = [...node.children].reverse()
  while (stack.length) {
    const cur = stack.pop() as XNode
    if (cur.name === name) out.push(cur)
    for (let k = cur.children.length - 1; k >= 0; k--) stack.push(cur.children[k])
  }
  return out
}

/** Atributo por nombre exacto o por nombre local (`val` casa con `w:val`). */
export function attr(node: XNode | undefined, name: string): string | undefined {
  if (!node) return undefined
  if (name in node.attrs) return node.attrs[name]
  for (const k of Object.keys(node.attrs)) if (k.endsWith(`:${name}`)) return node.attrs[k]
  return undefined
}

/** Texto plano de todos los nodos de texto de un subárbol. */
export function plainText(node: XNode): string {
  if (node.name === '#text') return node.text ?? ''
  let s = ''
  for (const c of node.children) s += plainText(c)
  return s
}
