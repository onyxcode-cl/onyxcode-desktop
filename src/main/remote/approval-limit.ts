/**
 * Tope de aprobaciones de comandos/ediciones «una vez» hechas desde el celular SIN confirmar en el Mac: 20 por celular y por hora
 * (ventana deslizante, en memoria; reiniciar la app lo reinicia, y con él el control remoto vuelve a estar apagado). Pasado el
 * tope, la aprobación se trata como clase D (el Mac pregunta): el celular no se queda sin respuesta, pero ya no actúa solo.
 */
export const APPROVAL_LIMIT_PER_HOUR = 20
export const APPROVAL_WINDOW_MS = 3_600_000

export class ApprovalLimiter {
  private readonly hits = new Map<string, number[]>()

  constructor(
    private readonly max: number = APPROVAL_LIMIT_PER_HOUR,
    private readonly windowMs: number = APPROVAL_WINDOW_MS,
    private readonly now: () => number = Date.now
  ) {}

  private recent(deviceId: string): number[] {
    const t = this.now()
    const list = (this.hits.get(deviceId) ?? []).filter((x) => t - x < this.windowMs)
    if (list.length > 0) this.hits.set(deviceId, list)
    else this.hits.delete(deviceId)
    return list
  }

  /** ¿Queda cupo? (sin gastarlo). */
  available(deviceId: string): boolean {
    return this.recent(deviceId).length < this.max
  }

  /** Gasta una aprobación. `false` = tope alcanzado (no se gasta nada). */
  take(deviceId: string): boolean {
    const list = this.recent(deviceId)
    if (list.length >= this.max) return false
    list.push(this.now())
    this.hits.set(deviceId, list)
    return true
  }

  /** Olvida los contadores de un celular (revocado) o de todos. */
  reset(deviceId?: string): void {
    if (deviceId === undefined) this.hits.clear()
    else this.hits.delete(deviceId)
  }
}
