/**
 * Botones de la entrega 2 que no son permisos: elegir una sesión (`s`), «Ver todo» (`o`), «Recibir archivo» (`f`).
 * El `callback_data` solo lleva un id aleatorio de 72 bits (14 bytes en total); la sesión, la salida o la ruta viven aquí, en `main`,
 * y el id está ligado al chat dueño y caduca. A diferencia de los permisos (`ButtonBook`, un solo uso), se pueden pulsar más de una
 * vez (volver a pedir un archivo) hasta que caduquen.
 */
import { randomBytes } from 'node:crypto'

type Clock = () => number

export type ActionKind = 's' | 'o' | 'f'

export interface ActionEntry<T = unknown> {
  id: string
  kind: ActionKind
  chatId: number
  expiresAt: number
  payload: T
}

export type ActionTake<T> = { ok: true; entry: ActionEntry<T> } | { ok: false; reason: 'bad' | 'unknown' | 'wrong-chat' | 'expired' }

const ACTION_RE = /^([sof]):([A-Za-z0-9_-]{12})$/

export class ActionBook {
  private readonly byId = new Map<string, ActionEntry>()

  constructor(
    private readonly now: Clock = Date.now,
    private readonly max = 300
  ) {}

  create<T>(kind: ActionKind, chatId: number, payload: T, ttlMs: number): ActionEntry<T> {
    this.purge()
    let id = ''
    do id = randomBytes(9).toString('base64url')
    while (this.byId.has(id))
    const entry: ActionEntry<T> = { id, kind, chatId, expiresAt: this.now() + ttlMs, payload }
    this.byId.set(id, entry)
    return entry
  }

  static data(entry: ActionEntry): string {
    return `${entry.kind}:${entry.id}`
  }

  static isAction(data: string | undefined): boolean {
    return typeof data === 'string' && ACTION_RE.test(data)
  }

  take<T>(data: string | undefined, chatId: number): ActionTake<T> {
    const m = typeof data === 'string' ? ACTION_RE.exec(data) : null
    if (!m) return { ok: false, reason: 'bad' }
    const entry = this.byId.get(m[2] as string)
    if (!entry || entry.kind !== m[1]) return { ok: false, reason: 'unknown' }
    if (entry.chatId !== chatId) return { ok: false, reason: 'wrong-chat' }
    if (this.now() >= entry.expiresAt) return { ok: false, reason: 'expired' }
    return { ok: true, entry: entry as ActionEntry<T> }
  }

  /** Anula los botones de un tipo (al elegir otra sesión, los de archivos y salidas de la anterior dejan de valer). */
  clearKind(kind: ActionKind): void {
    for (const [id, e] of this.byId) if (e.kind === kind) this.byId.delete(id)
  }

  clear(): void {
    this.byId.clear()
  }

  get size(): number {
    return this.byId.size
  }

  private purge(): void {
    const t = this.now()
    for (const [id, e] of this.byId) if (t >= e.expiresAt) this.byId.delete(id)
    while (this.byId.size >= this.max) {
      const first = this.byId.keys().next().value as string | undefined
      if (first === undefined) break
      this.byId.delete(first)
    }
  }
}
