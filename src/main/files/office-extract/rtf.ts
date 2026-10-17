import { cleanLine, Out } from './markdown'
import { ExtractError } from './zip'
import type { Extracted } from './types'

/** Destinos de RTF que no son texto del documento (tablas de fuentes, colores, imágenes, campos de código…). */
const SKIP_DESTINATIONS = new Set([
  'fonttbl',
  'colortbl',
  'stylesheet',
  'info',
  'pict',
  'object',
  'header',
  'headerl',
  'headerr',
  'headerf',
  'footer',
  'footerl',
  'footerr',
  'footerf',
  'themedata',
  'datastore',
  'listtable',
  'listoverridetable',
  'revtbl',
  'rsidtbl',
  'generator',
  'xmlnstbl',
  'fldinst',
  'colorschememapping',
  'latentstyles',
  'datafield',
  'bkmkstart',
  'bkmkend'
])

const cp1252 = new TextDecoder('windows-1252')

/** RTF (.rtf): texto plano. Sin objetos incrustados, imágenes ni campos: solo el texto visible. */
export function extractRtf(buf: Uint8Array): Extracted {
  // RTF es ASCII de 7 bits (lo demás va escapado); latin1 conserva los bytes tal cual.
  const s = Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength).toString('latin1')
  if (!/^\s*\{\\rtf/.test(s.slice(0, 64))) throw new ExtractError('corrupt')
  const stack: { skip: boolean; uc: number }[] = []
  let skip = false
  let uc = 1
  let pendingSkip = 0
  let text = ''
  const n = s.length
  let i = 0
  const emit = (str: string): void => {
    if (skip) return
    if (pendingSkip > 0) {
      pendingSkip--
      return
    }
    text += str
  }
  while (i < n) {
    const c = s[i]
    if (c === '{') {
      stack.push({ skip, uc })
      // Destino opcional `{\*\algo}`: se ignora entero.
      if (s[i + 1] === '\\' && s[i + 2] === '*') skip = true
      i++
    } else if (c === '}') {
      const top = stack.pop()
      if (top) {
        skip = top.skip
        uc = top.uc
      }
      i++
    } else if (c === '\\') {
      const d = s[i + 1]
      if (d === undefined) break
      if (d === '\\' || d === '{' || d === '}') {
        emit(d)
        i += 2
      } else if (d === "'") {
        const hex = s.slice(i + 2, i + 4)
        if (/^[0-9a-fA-F]{2}$/.test(hex)) emit(cp1252.decode(Uint8Array.of(parseInt(hex, 16))))
        i += 4
      } else if (d === '~') {
        emit(' ')
        i += 2
      } else if (d === '-' || d === '_' || d === '*' || d === '|' || d === ':') {
        if (d === '_') emit('-')
        i += 2
      } else if (d === '\n' || d === '\r') {
        emit('\n')
        i += 2
      } else if (/[a-zA-Z]/.test(d)) {
        let j = i + 1
        while (j < n && /[a-zA-Z]/.test(s[j])) j++
        const word = s.slice(i + 1, j)
        let numStr = ''
        if (s[j] === '-') numStr = '-'
        let k = numStr ? j + 1 : j
        while (k < n && /[0-9]/.test(s[k])) k++
        const digits = s.slice(numStr ? j + 1 : j, k)
        const num = digits ? parseInt(numStr + digits, 10) : undefined
        if (s[k] === ' ') k++ // un espacio tras la palabra de control es su delimitador
        i = k
        if (SKIP_DESTINATIONS.has(word)) skip = true
        else if (word === 'par' || word === 'line' || word === 'sect' || word === 'page') emit('\n')
        else if (word === 'tab') emit(' ')
        else if (word === 'cell') emit(' | ')
        else if (word === 'row') emit('\n')
        else if (word === 'emdash') emit('—')
        else if (word === 'endash') emit('–')
        else if (word === 'bullet') emit('•')
        else if (word === 'lquote') emit('‘')
        else if (word === 'rquote') emit('’')
        else if (word === 'ldblquote') emit('“')
        else if (word === 'rdblquote') emit('”')
        else if (word === 'uc' && num !== undefined) uc = Math.max(0, Math.min(8, num))
        else if (word === 'u' && num !== undefined) {
          const code = num < 0 ? num + 65536 : num
          emit(String.fromCharCode(code))
          if (!skip) pendingSkip = uc
        } else if (word === 'bin' && num !== undefined && num > 0) i = Math.min(n, i + num)
      } else {
        i += 2
      }
    } else if (c === '\r' || c === '\n') {
      i++
    } else {
      emit(c)
      i++
    }
  }
  const out = new Out()
  const lines = text.split('\n').map(cleanLine)
  let blank = true
  for (const l of lines) {
    if (!l) {
      blank = true
      continue
    }
    if (blank && out.lines.length > 0 && !out.add('')) break
    blank = false
    if (!out.add(l)) break
  }
  return { body: out.toString(), units: null, notes: [], truncated: out.truncated }
}
