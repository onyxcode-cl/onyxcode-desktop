/**
 * Lector de JSON ESTRICTO para lo que la puerta de main revisa antes de reenviarlo a un conector (`mcp-proxy.ts`).
 *
 * `JSON.parse` se queda con la ÚLTIMA de dos claves repetidas, y otros lectores (por ejemplo `encoding/json` de Go) con la primera, o
 * comparan las claves sin distinguir mayúsculas y con equivalencias Unicode (`ſ` = `s`, `K` = `k`). Si main y el servidor leen el mismo
 * texto de forma distinta, la tarjeta puede mostrar una cosa y el servidor ejecutar otra. Aquí, en CADA objeto, se rechaza:
 * - una clave repetida;
 * - dos claves que coinciden al pasarlas a minúsculas y normalizarlas con NFKC (`method`/`Method`, `arguments`/`argumentſ`).
 * Además hay un tope de profundidad. Lo leído se reenvía con `JSON.stringify`, nunca los bytes originales.
 */

export const MAX_DEPTH = 64

export class StrictJsonError extends Error {}

/** Forma con la que se comparan dos claves (lo que un lector permisivo podría tomar como la misma). */
export const foldKey = (k: string): string => k.normalize('NFKC').toLowerCase().normalize('NFKC')

/** Lee `text` como JSON; lanza `StrictJsonError` ante JSON inválido, claves repetidas o equivalentes, o anidamiento excesivo. */
export function parseStrictJson(text: string): unknown {
  let i = 0
  const fail = (why: string): never => {
    throw new StrictJsonError(why)
  }
  const ws = (): void => {
    while (i < text.length && (text[i] === ' ' || text[i] === '\t' || text[i] === '\n' || text[i] === '\r')) i++
  }
  const str = (): string => {
    if (text[i] !== '"') fail('string')
    i++
    let out = ''
    for (;;) {
      if (i >= text.length) fail('unterminated')
      const c = text[i++]!
      if (c === '"') return out
      if (c === '\\') {
        const e = text[i++]
        if (e === '"' || e === '\\' || e === '/') out += e
        else if (e === 'b') out += '\b'
        else if (e === 'f') out += '\f'
        else if (e === 'n') out += '\n'
        else if (e === 'r') out += '\r'
        else if (e === 't') out += '\t'
        else if (e === 'u') {
          const h = text.slice(i, i + 4)
          if (!/^[0-9a-fA-F]{4}$/.test(h)) fail('escape')
          out += String.fromCharCode(parseInt(h, 16))
          i += 4
        } else fail('escape')
      } else if (c.charCodeAt(0) < 0x20) fail('control')
      else out += c
    }
  }
  const num = (): number => {
    const m = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(text.slice(i))
    if (!m) fail('number')
    i += m![0].length
    return Number(m![0])
  }
  const value = (depth: number): unknown => {
    if (depth > MAX_DEPTH) fail('depth')
    ws()
    const c = text[i]
    if (c === '{') {
      i++
      const obj: Record<string, unknown> = {}
      const seen = new Set<string>()
      ws()
      if (text[i] === '}') {
        i++
        return obj
      }
      for (;;) {
        ws()
        const k = str()
        const f = foldKey(k)
        if (seen.has(f)) fail(`duplicate-key:${k}`)
        seen.add(f)
        ws()
        if (text[i++] !== ':') fail('colon')
        const v = value(depth + 1)
        // defineProperty: una clave `__proto__` queda como dato, sin tocar el prototipo.
        Object.defineProperty(obj, k, { value: v, enumerable: true, writable: true, configurable: true })
        ws()
        const sep = text[i++]
        if (sep === '}') return obj
        if (sep !== ',') fail('object')
      }
    }
    if (c === '[') {
      i++
      const arr: unknown[] = []
      ws()
      if (text[i] === ']') {
        i++
        return arr
      }
      for (;;) {
        arr.push(value(depth + 1))
        ws()
        const sep = text[i++]
        if (sep === ']') return arr
        if (sep !== ',') fail('array')
      }
    }
    if (c === '"') return str()
    if (text.startsWith('true', i)) {
      i += 4
      return true
    }
    if (text.startsWith('false', i)) {
      i += 5
      return false
    }
    if (text.startsWith('null', i)) {
      i += 4
      return null
    }
    return num()
  }
  const v = value(0)
  ws()
  if (i !== text.length) fail('trailing')
  return v
}
