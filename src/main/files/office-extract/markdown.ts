import { OFFICE_MAX_CHARS } from '@shared/attach-office'

/** Acumulador de líneas con tope de caracteres: lo que no cabe se descarta y queda marcado como recortado. */
export class Out {
  readonly lines: string[] = []
  chars = 0
  truncated = false
  /** Líneas de contenido que sí se escribieron (para saber cuántas filas/párrafos entraron). */
  constructor(private readonly max: number = OFFICE_MAX_CHARS) {}

  get full(): boolean {
    return this.truncated
  }

  /** Añade una línea; devuelve `false` (y marca el recorte) si ya no cabe. */
  add(line: string): boolean {
    if (this.truncated) return false
    const cost = line.length + 1
    if (this.chars + cost > this.max) {
      this.truncated = true
      return false
    }
    this.lines.push(line)
    this.chars += cost
    return true
  }

  toString(): string {
    return this.lines.join('\n')
  }
}

/** Una celda de tabla Markdown: sin saltos de línea ni barras que rompan la tabla. */
export function mdCell(s: string, maxChars = Infinity): string {
  let v = s
    .replace(/\s*[\r\n]+\s*/g, ' ')
    .replace(/\|/g, '\\|')
    .trim()
  if (v.length > maxChars) v = `${v.slice(0, maxChars)}…`
  return v
}

/** Filas → líneas de tabla Markdown (la primera fila hace de encabezado). Rellena las filas cortas. */
export function mdTableLines(rows: string[][]): string[] {
  if (rows.length === 0) return []
  const cols = Math.max(1, ...rows.map((r) => r.length))
  const pad = (r: string[]): string[] => [...r, ...Array.from({ length: cols - r.length }, () => '')]
  const line = (r: string[]): string => `| ${pad(r).join(' | ')} |`
  return [line(rows[0]), `| ${Array.from({ length: cols }, () => '---').join(' | ')} |`, ...rows.slice(1).map(line)]
}

/** Quita caracteres de control (menos tab y salto de línea) y recorta espacios sobrantes de una línea de texto. */
export function cleanLine(s: string): string {
  return s
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .replace(/[ \t]+/g, ' ')
    .trim()
}
