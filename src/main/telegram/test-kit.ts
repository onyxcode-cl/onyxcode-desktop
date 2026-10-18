/**
 * Utilidades de las pruebas del puente con Telegram: motor falso, almacén seguro en memoria y un montaje completo
 * (servidor de Telegram falso + servicio + carpeta temporal). Solo se importa desde `*.test.ts`.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startFakeTelegram, type FakeTelegram } from '../../../e2e/fake-telegram/server.mjs'
import type { SafeStorageLike } from '../remote/devices-store'
import { TelegramApi } from './api'
import { EngineReplyError, type EngineEvent, type EngineLink, type EnginePermission } from './engine-link'
import { TelegramService, type Limits } from './service'
import { TelegramStore } from './store'

/** «Cifrado» de pruebas: nada de texto plano en el archivo (invierte y codifica en base64). */
export class MemorySafeStorage implements SafeStorageLike {
  constructor(private available = true) {}
  setAvailable(v: boolean): void {
    this.available = v
  }
  isEncryptionAvailable(): boolean {
    return this.available
  }
  encryptString(plain: string): Buffer {
    return Buffer.from('ENC1' + Buffer.from([...plain].reverse().join('')).toString('base64'), 'utf8')
  }
  decryptString(enc: Buffer): string {
    const s = enc.toString('utf8')
    if (!s.startsWith('ENC1')) throw new Error('formato desconocido')
    return [...Buffer.from(s.slice(4), 'base64').toString('utf8')].reverse().join('')
  }
}

export class FakeEngine implements EngineLink {
  handler: ((ev: EngineEvent) => void) | null = null
  started = 0
  stopped = 0
  replies: { id: string; reply: 'once' | 'reject' }[] = []
  /** Cómo responde `reply`. */
  behavior: 'ok' | 'not-found' | 'fail' = 'ok'
  /** Ids que el «motor» dice tener pendientes; `null` = no se puede saber. */
  pendingSet: Set<string> | null = null
  listed: EnginePermission[] = []

  start(h: (ev: EngineEvent) => void): void {
    this.handler = h
    this.started++
  }
  stop(): void {
    this.handler = null
    this.stopped++
  }
  async reply(req: EnginePermission, reply: 'once' | 'reject'): Promise<void> {
    if (this.behavior === 'not-found') throw new EngineReplyError('not-found', 'ya no está')
    if (this.behavior === 'fail') throw new EngineReplyError('failed', 'caído')
    this.replies.push({ id: req.id, reply })
    this.pendingSet?.delete(req.id)
  }
  async pendingIds(): Promise<Set<string> | null> {
    return this.pendingSet
  }
  async listPending(): Promise<EnginePermission[]> {
    return this.listed
  }
  /** El motor emite un evento hacia el servicio. */
  emit(ev: EngineEvent): void {
    this.handler?.(ev)
  }
  get running(): boolean {
    return this.handler !== null
  }
}

export function permission(over: Partial<EnginePermission> & { id: string }): EnginePermission {
  return { sessionID: 'ses_1', permission: 'bash', patterns: [], metadata: {}, api: 'v1', ...over }
}

/** Token falso armado en tiempo de ejecución (nunca un literal con forma de token en el repositorio). */
export function fakeToken(id = '123456789', fill = 'q'): string {
  return `${id}:${fill.repeat(7)}-${'Zk3'.repeat(9)}`.slice(0, id.length + 1 + 35)
}

export interface Rig {
  tg: FakeTelegram
  dir: string
  store: TelegramStore
  safe: MemorySafeStorage
  engine: FakeEngine
  svc: TelegramService
  token: string
  logs: string[]
  clock: { now: number }
  /** Crea otro servicio sobre la misma carpeta y el mismo servidor (reinicio de la app). */
  restart(): TelegramService
  stop(): Promise<void>
}

export async function makeRig(
  o: {
    limits?: Partial<Limits>
    token?: string
    codeGen?: () => string
    secure?: boolean
    maxHoldMs?: number
    sleep?: (ms: number) => Promise<void>
  } = {}
): Promise<Rig> {
  const token = o.token ?? fakeToken()
  const tg = await startFakeTelegram({ token, maxHoldMs: o.maxHoldMs ?? 150 })
  const dir = mkdtempSync(join(tmpdir(), 'lzx-tg-test-'))
  const safe = new MemorySafeStorage(o.secure ?? true)
  const clock = { now: Date.now() }
  const logs: string[] = []
  const engine = new FakeEngine()
  const services: TelegramService[] = []
  const build = (): TelegramService => {
    const store = new TelegramStore(dir, safe)
    rig.store = store
    const svc = new TelegramService({
      store,
      engine,
      makeApi: (t) =>
        new TelegramApi({
          token: t,
          baseUrl: tg.url,
          minGapMs: 0,
          sleep: o.sleep ?? ((ms) => new Promise((r) => setTimeout(r, Math.min(ms, 20))))
        }),
      now: () => clock.now,
      limits: { permissionGraceMs: 0, ...o.limits },
      pollTimeoutSec: 1,
      codeGen: o.codeGen,
      log: (m) => logs.push(m)
    })
    services.push(svc)
    return svc
  }
  const rig: Rig = {
    tg,
    dir,
    store: new TelegramStore(dir, safe),
    safe,
    engine,
    svc: null as unknown as TelegramService,
    token,
    logs,
    clock,
    restart: () => {
      const s = build()
      s.init()
      rig.svc = s
      return s
    },
    stop: async () => {
      for (const s of services) s.dispose()
      await tg.stop()
      rmSync(dir, { recursive: true, force: true })
    }
  }
  rig.svc = build()
  rig.svc.init()
  return rig
}

/** Espera hasta que la condición sea verdadera (sondeo corto). */
export async function until(cond: () => boolean, ms = 3000, what = 'condición'): Promise<void> {
  const t0 = Date.now()
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error(`tiempo agotado esperando: ${what}`)
    await new Promise((r) => setTimeout(r, 10))
  }
}

/** Pausa corta para comprobar que algo NO ocurre. */
export const settle = (ms = 250): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** Deja el servicio activado, con bot y un chat vinculado (por el camino real: token → /start → código). */
export async function linkOwner(rig: Rig, chatId = 5001): Promise<string> {
  const code = '123456'
  await rig.svc.saveToken(rig.token)
  rig.svc.setEnabled(true)
  const st = rig.svc.getState()
  if (st.phase !== 'linking') throw new Error(`se esperaba «linking», hay «${st.phase}»`)
  rig.tg.sendUser({ chatId, text: st.code ?? code })
  await until(() => rig.svc.getState().phase === 'linked', 3000, 'vinculación')
  return st.code as string
}
