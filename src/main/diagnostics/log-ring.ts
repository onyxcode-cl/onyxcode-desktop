/**
 * Anillo de líneas del motor: guarda las últimas `maxLines` líneas / `maxBytes` bytes de lo que escribe
 * `opencode serve` por stdout/stderr. Los trozos llegan partidos en cualquier punto: la última línea queda
 * «parcial» hasta que llega su salto de línea (y se devuelve igualmente al leer).
 */
export class LineRing {
  private complete: string[] = []
  private partial = ''
  private bytes = 0

  constructor(
    private readonly maxLines = 2000,
    private readonly maxBytes = 512 * 1024
  ) {}

  push(chunk: string): void {
    if (!chunk) return
    const text = this.partial + chunk
    const parts = text.split(/\r?\n/)
    this.partial = parts.pop() ?? ''
    for (const line of parts) {
      this.complete.push(line)
      this.bytes += Buffer.byteLength(line) + 1
    }
    // Una «línea» parcial sin fin no puede crecer sin límite.
    if (this.partial.length > this.maxBytes) {
      this.partial = this.partial.slice(-this.maxBytes)
    }
    this.trim()
  }

  private trim(): void {
    let drop = Math.max(0, this.complete.length - this.maxLines)
    let bytes = this.bytes
    for (let i = 0; i < drop; i++) bytes -= Buffer.byteLength(this.complete[i]) + 1
    while (bytes + Buffer.byteLength(this.partial) > this.maxBytes && drop < this.complete.length) {
      bytes -= Buffer.byteLength(this.complete[drop]) + 1
      drop++
    }
    if (drop > 0) this.complete.splice(0, drop)
    this.bytes = Math.max(0, bytes)
  }

  /** Líneas guardadas (la parcial al final, si la hay); con `max`, solo las últimas `max`. */
  lines(max?: number): string[] {
    const all = this.partial ? [...this.complete, this.partial] : [...this.complete]
    return max !== undefined && all.length > max ? all.slice(all.length - max) : all
  }

  /** Últimas `n` líneas unidas (para el mensaje de error de arranque). */
  tail(n: number): string {
    return this.lines(n).join('\n')
  }

  get size(): number {
    return this.complete.length + (this.partial ? 1 : 0)
  }

  clear(): void {
    this.complete = []
    this.partial = ''
    this.bytes = 0
  }
}
