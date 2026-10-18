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
import {
  EngineReplyError,
  type EngineEvent,
  type EngineLink,
  type EngineMessage,
  type EnginePart,
  type EnginePermission,
  type EngineSessionInfo
} from './engine-link'
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
  // ---- sesiones (entrega 2) ----
  sessions = new Map<string, { info: EngineSessionInfo; messages: EngineMessage[] }>()
  prompts: {
    directory: string
    id: string
    input: {
      agent: string
      model?: { providerID: string; modelID: string }
      text: string
      files: { mime: string; filename: string; url: string }[]
    }
  }[] = []
  /** `prompt` falla con este comportamiento. */
  promptBehavior: 'ok' | 'fail' | 'not-found' = 'ok'
  /** `getSession`/`messages` fallan (motor caído). */
  down = false
  private seq = 0

  async listSessions(dirs: readonly { directory: string; kind: 'chat' | 'code' }[], limit: number): Promise<EngineSessionInfo[]> {
    if (this.down) return []
    return [...this.sessions.values()]
      .map((x) => x.info)
      .filter((i) => dirs.some((d) => d.directory === i.directory && d.kind === i.kind))
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, limit)
  }
  async getSession(directory: string, id: string): Promise<EngineSessionInfo | null | 'error'> {
    if (this.down) return 'error'
    const x = this.sessions.get(id)
    return x && x.info.directory === directory ? { ...x.info } : null
  }
  async messages(directory: string, id: string): Promise<EngineMessage[] | null> {
    if (this.down) return null
    const x = this.sessions.get(id)
    return x && x.info.directory === directory ? x.messages.map((m) => ({ ...m, parts: [...m.parts] })) : null
  }
  async prompt(
    directory: string,
    id: string,
    input: {
      agent: string
      model?: { providerID: string; modelID: string }
      text: string
      files: { mime: string; filename: string; url: string }[]
    }
  ): Promise<void> {
    if (this.promptBehavior === 'fail') throw new EngineReplyError('failed', 'caído')
    if (this.promptBehavior === 'not-found') throw new EngineReplyError('not-found', 'no existe')
    this.prompts.push({ directory, id, input })
  }

  /** Crea una sesión de prueba. */
  addSession(o: Partial<EngineSessionInfo> & { id: string }): EngineSessionInfo {
    const info: EngineSessionInfo = {
      title: 'Conversación de prueba',
      directory: '/chat',
      kind: 'chat',
      updatedAt: Date.now(),
      busy: false,
      mode: 'unknown',
      agent: null,
      ...o
    }
    this.sessions.set(info.id, { info, messages: [] })
    return info
  }
  private nextId(prefix: string): string {
    return `${prefix}${String(++this.seq).padStart(6, '0')}`
  }
  addUser(sid: string, text: string): string {
    const id = this.nextId('msg_u')
    this.sessions.get(sid)?.messages.push({
      id,
      role: 'user',
      created: Date.now(),
      completed: true,
      error: '',
      agent: 'build',
      model: { providerID: 'opencode', modelID: 'modelo-de-prueba' },
      parts: [{ id: this.nextId('prt'), type: 'text', text }]
    })
    return id
  }
  addAssistant(sid: string, parts: EnginePart[], o: { completed?: boolean; error?: string } = {}): string {
    const id = this.nextId('msg_a')
    this.sessions.get(sid)?.messages.push({
      id,
      role: 'assistant',
      created: Date.now(),
      completed: o.completed ?? true,
      error: o.error ?? '',
      agent: null,
      model: null,
      parts
    })
    return id
  }
  /** Cambia las partes del último mensaje del asistente (el avance en vivo). */
  setLastAssistant(sid: string, parts: EnginePart[], completed: boolean): void {
    const list = this.sessions.get(sid)?.messages ?? []
    for (let i = list.length - 1; i >= 0; i--) {
      const m = list[i] as EngineMessage
      if (m.role === 'assistant') {
        m.parts = parts
        m.completed = completed
        return
      }
    }
  }
  setBusy(sid: string, busy: boolean): void {
    const x = this.sessions.get(sid)
    if (x) x.info.busy = busy
  }

  /** El motor emite un evento hacia el servicio. */
  emit(ev: EngineEvent): void {
    this.handler?.(ev)
  }
  get running(): boolean {
    return this.handler !== null
  }
}

export function textPart(text: string, id = `prt_t${Math.random().toString(16).slice(2, 8)}`): EnginePart {
  return { id, type: 'text', text }
}
export function toolPart(
  tool: string,
  input: Record<string, unknown>,
  status: 'pending' | 'running' | 'completed' | 'error' = 'completed',
  extra: { output?: string; diff?: string; error?: string; start?: number; end?: number } = {}
): EnginePart {
  return {
    id: `prt_${tool}${Math.random().toString(16).slice(2, 8)}`,
    type: 'tool',
    tool,
    state: {
      status,
      input,
      start: extra.start ?? Date.now() - 2000,
      end: status === 'completed' ? (extra.end ?? Date.now()) : undefined,
      ...extra
    }
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
    editFloodMs?: number
    sessionDirs?: { directory: string; kind: 'chat' | 'code' }[]
    fileRoots?: (s: { directory: string; kind: 'chat' | 'code' }) => string[]
  } = {}
): Promise<Rig> {
  const token = o.token ?? fakeToken()
  const tg = await startFakeTelegram({ token, maxHoldMs: o.maxHoldMs ?? 150, editFloodMs: o.editFloodMs })
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
      limits: { permissionGraceMs: 0, liveEditGapMs: 40, sessionCheckMs: 0, ...o.limits },
      sessionDirs: () =>
        o.sessionDirs ?? [
          { directory: '/chat', kind: 'chat' },
          { directory: '/proj', kind: 'code' }
        ],
      fileRoots: o.fileRoots,
      modelFor: () => ({ providerID: 'opencode', modelID: 'por-defecto' }),
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
  // Margen ×4: en un equipo ocupado (la suite completa en un contenedor con pocos núcleos) 3 s reales no alcanzaban y la prueba fallaba a veces.
  const limit = ms * 4
  while (!cond()) {
    if (Date.now() - t0 > limit) throw new Error(`tiempo agotado esperando: ${what}`)
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
