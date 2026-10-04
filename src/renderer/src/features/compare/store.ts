/**
 * Estado vivo de «Comparar modelos» en el renderer. MAIN orquesta (crea las copias y sesiones, envía el prompt, reintenta por
 * cuota, mide y cancela); el renderer solo pinta: guarda los manifiestos que llegan por `compare:changed` y reduce el stream de
 * eventos del motor filtrando por los `sessionID` de las columnas. No se persiste nada aquí: lo que debe sobrevivir a un reinicio
 * lo guarda el manifiesto de main (las columnas recuperadas llegan con `interrupted`).
 */
import { create } from 'zustand'
import { t } from '@shared/i18n'
import type {
  CompareAdoptResult,
  CompareColumnManifest,
  CompareDiffResult,
  CompareManifest,
  CompareMode,
  CompareModelRef,
  ComparePermissionMode,
  ComparePreflight
} from '@shared/ipc-code'
import { errText } from '../../lib/format'
import { loadGlobalUsage } from '../../components/UsageMeter'
import type { OcEvent } from '../../lib/opencode'
import { isRemoteSurface } from '../../lib/platform'
import { createFrameQueue } from '../../lib/frame-queue'
import {
  byId,
  createBuffers,
  createLoadTracker,
  mergeSnapshot,
  messageEventSessionID,
  markSeen,
  reduceEvent,
  type Buffers,
  type ConvSlice
} from '../../lib/session-reducer'
import { onOpencodeEvent, onStreamReconnect, useServer } from '../../stores/server'
import type { PendingPermission } from '../code/impl/types'
import { compareApi } from './api'
import { isActiveManifest, validateSelection } from './model'

// ───────────────────────────── tipos ─────────────────────────────

export type BlockerKind = 'attachments' | 'noRepo' | 'busy' | 'models'

export interface ConfirmRequest {
  id: string
  mode: CompareMode
  directory: string | null
  text: string
  permissionMode: ComparePermissionMode
  models: CompareModelRef[]
  blocker: BlockerKind | null
  /** `null` mientras se consulta (solo en Code). */
  preflight: ComparePreflight | null
  checking: boolean
  /** Gasto de hoy en USD, si se pudo saber (aviso «×N»). */
  spent: number | null
  starting: boolean
  error: string | null
}

export type DiffState = { status: 'loading' } | { status: 'ready'; diff: CompareDiffResult } | { status: 'error'; message: string }

export interface AdoptFailure {
  reason: Extract<CompareAdoptResult, { ok: false }>['reason']
  files: string[]
}

export interface Notice {
  seq: number
  mode: CompareMode
  tone: 'info' | 'warn'
  text: string
}

export interface CompareState {
  manifests: Record<string, CompareManifest>
  loaded: boolean
  loadError: string | null
  /** Desde dónde se lanzó cada comparación (para mostrarla solo en su proyecto). */
  origin: Record<string, { mode: CompareMode; directory: string | null }>
  /** Comparaciones cuya vista está abierta (las recuperadas se abren desde la franja). */
  opened: Record<string, boolean>
  /** Modelos armados por contexto (`code:<carpeta>` / `chat:`). */
  armed: Record<string, CompareModelRef[]>
  confirm: ConfirmRequest | null
  slice: ConvSlice
  permissions: Record<string, PendingPermission & { index: number; compareId: string }>
  /** Acciones en curso por columna (`id:index`). */
  busy: Record<string, string | undefined>
  /** Último error de acción por comparación. */
  errors: Record<string, string | undefined>
  diffs: Record<string, DiffState | undefined>
  adoptFailures: Record<string, AdoptFailure | undefined>
  notice: Notice | null
}

const emptySlice = (): ConvSlice => ({ messages: {}, status: {}, errors: {}, sessions: {} })

const initial = (): CompareState => ({
  manifests: {},
  loaded: false,
  loadError: null,
  origin: {},
  opened: {},
  armed: {},
  confirm: null,
  slice: emptySlice(),
  permissions: {},
  busy: {},
  errors: {},
  diffs: {},
  adoptFailures: {},
  notice: null
})

export const useCompare = create<CompareState>(() => initial())

const set = useCompare.setState
const get = useCompare.getState

// ───────────────────────────── utilidades puras ─────────────────────────────

export const ctxKey = (mode: CompareMode, directory: string | null): string => `${mode}:${mode === 'code' ? (directory ?? '') : ''}`
export const colKey = (id: string, index: number): string => `${id}:${index}`

/** Carpeta de la columna en el motor: la copia (Code) o la carpeta de Chat. */
function columnDirectory(m: CompareManifest, c: CompareColumnManifest): string | null {
  if (m.mode === 'code') return c.worktree?.path ?? null
  return useServer.getState().connection?.chatDirectory ?? null
}

/** Reduce una tanda de eventos sobre la conversación de las columnas (solo las sesiones aceptadas). Pura salvo `buffers`. */
export function reduceColumnEvents(
  slice: ConvSlice,
  events: readonly OcEvent[],
  buffers: Buffers,
  accept: (sessionID: string) => boolean
): ConvSlice {
  let cur = slice
  for (const ev of events) cur = reduceEvent(cur, ev, buffers, { accept, dedupe: false }).slice
  return cur
}

// ───────────────────────────── manifiestos ─────────────────────────────

const watched = new Set<string>()
const buffers: Buffers = createBuffers()
const hydrated = new Set<string>()
/** Comparaciones ya cerradas aquí: un `compare:changed` rezagado (emitido por main antes del cierre) no las resucita. */
const closedIds = new Set<string>()

function rebuildWatched(): void {
  watched.clear()
  for (const m of Object.values(get().manifests)) for (const c of m.columns) if (c.sessionID && !c.discarded) watched.add(c.sessionID)
}

export function applyManifest(m: CompareManifest): void {
  if (closedIds.has(m.id)) return
  set((s) => ({ manifests: { ...s.manifests, [m.id]: m } }))
  rebuildWatched()
  void hydrate(m)
}

function dropManifest(id: string): void {
  closedIds.add(id)
  const m = get().manifests[id]
  set((s) => {
    const manifests = { ...s.manifests }
    delete manifests[id]
    const slice: ConvSlice = { ...s.slice, messages: { ...s.slice.messages }, status: { ...s.slice.status }, errors: { ...s.slice.errors } }
    for (const c of m?.columns ?? []) {
      if (!c.sessionID) continue
      delete slice.messages[c.sessionID]
      delete slice.status[c.sessionID]
      delete slice.errors[c.sessionID]
      hydrated.delete(c.sessionID)
    }
    const permissions = Object.fromEntries(Object.entries(s.permissions).filter(([, p]) => p.compareId !== id))
    const opened = { ...s.opened }
    delete opened[id]
    return { manifests, slice, permissions, opened }
  })
  rebuildWatched()
}

export async function loadCompare(): Promise<void> {
  const api = compareApi()
  if (!api) return
  try {
    const list = await api.list()
    set((s) => ({
      // Lo que ya llegó por `compare:changed` es más reciente que la lista.
      manifests: { ...Object.fromEntries(list.map((m) => [m.id, m])), ...s.manifests },
      loaded: true,
      loadError: null
    }))
    rebuildWatched()
    for (const m of list) void hydrate(m)
  } catch (err) {
    set({ loaded: true, loadError: errText(err) })
  }
}

// ───────────────────────────── conversación de las columnas ─────────────────────────────

const queue = createFrameQueue<OcEvent>((events) => {
  const cur = get().slice
  const next = reduceColumnEvents(cur, events, buffers, (sid) => watched.has(sid))
  if (next !== cur) set({ slice: next })
})

/** Recarga los mensajes de las sesiones de una comparación (una sola vez por sesión salvo `force`). */
export async function hydrate(m: CompareManifest, force = false): Promise<void> {
  const client = useServer.getState().client
  if (!client) return
  await Promise.all(
    m.columns.map(async (c) => {
      const sid = c.sessionID
      if (!sid || c.discarded) return
      if (!force && hydrated.has(sid)) return
      const dir = columnDirectory(m, c)
      if (!dir) return
      hydrated.add(sid)
      queue.flush() // lo anterior a la carga no debe registrarse en el tracker
      const tracker = createLoadTracker()
      buffers.loading.set(sid, tracker)
      try {
        const res = await client.session.messages({ sessionID: sid, directory: dir })
        if (res.error || !res.data) throw new Error(String(res.error ?? 'empty'))
        queue.flush()
        const entries = res.data.map((e) => ({ info: e.info, parts: [...e.parts].sort(byId) })).sort((a, b) => byId(a.info, b.info))
        set((s) => ({
          slice: { ...s.slice, messages: { ...s.slice.messages, [sid]: mergeSnapshot(entries, s.slice.messages[sid] ?? [], tracker) } }
        }))
      } catch {
        hydrated.delete(sid) // se reintentará con la próxima actualización del manifiesto o la reconexión
      } finally {
        buffers.loading.delete(sid)
      }
    })
  )
}

function rehydrateAll(): void {
  for (const m of Object.values(get().manifests)) void hydrate(m, true)
}

function columnOf(sessionID: string | undefined, directory: string): { m: CompareManifest; c: CompareColumnManifest } | null {
  for (const m of Object.values(get().manifests)) {
    for (const c of m.columns) {
      if (c.discarded) continue
      if ((sessionID && c.sessionID === sessionID) || (c.worktree && c.worktree.path === directory)) return { m, c }
    }
  }
  return null
}

/** Entrada del stream global de eventos del motor. */
export function handleEvent(ev: OcEvent, directory: string): void {
  switch (ev.type) {
    case 'permission.asked': {
      const p = ev.properties
      const hit = columnOf(p.sessionID, directory)
      if (!hit) return
      set((s) => ({
        permissions: {
          ...s.permissions,
          [p.id]: {
            id: p.id,
            sessionID: p.sessionID,
            permission: p.permission,
            patterns: p.patterns,
            metadata: p.metadata ?? {},
            always: p.always,
            tool: p.tool,
            api: 'v1',
            index: hit.c.index,
            compareId: hit.m.id
          }
        }
      }))
      return
    }
    case 'permission.v2.asked': {
      const p = ev.properties
      const hit = columnOf(p.sessionID, directory)
      if (!hit) return
      set((s) => ({
        permissions: {
          ...s.permissions,
          [p.id]: {
            id: p.id,
            sessionID: p.sessionID,
            permission: p.action,
            patterns: p.resources,
            metadata: p.metadata ?? {},
            always: p.save ?? [],
            tool: p.source ? { messageID: p.source.messageID, callID: p.source.callID } : undefined,
            api: 'v2',
            index: hit.c.index,
            compareId: hit.m.id
          }
        }
      }))
      return
    }
    case 'permission.replied':
    case 'permission.v2.replied': {
      const { requestID } = ev.properties
      if (!(requestID in get().permissions)) return
      set((s) => {
        const permissions = { ...s.permissions }
        delete permissions[requestID]
        return { permissions }
      })
      return
    }
    default: {
      const sid = messageEventSessionID(ev)
      if (!sid || !watched.has(sid)) return
      if (ev.id && !markSeen(buffers.seen, ev.id)) return
      queue.push(ev)
    }
  }
}

export async function replyPermission(p: PendingPermission, reply: 'once' | 'reject'): Promise<void> {
  const client = useServer.getState().client
  if (!client) return
  const hit = columnOf(p.sessionID, '')
  const dir = hit ? columnDirectory(hit.m, hit.c) : null
  try {
    if (p.api === 'v2') await client.v2.session.permission.reply({ sessionID: p.sessionID, requestID: p.id, reply })
    else await client.permission.reply({ requestID: p.id, reply, ...(dir ? { directory: dir } : {}) })
    set((s) => {
      const permissions = { ...s.permissions }
      delete permissions[p.id]
      return { permissions }
    })
  } catch (err) {
    if (hit) set((s) => ({ errors: { ...s.errors, [hit.m.id]: errText(err) } }))
  }
}

// ───────────────────────────── arranque (suscripciones) ─────────────────────────────

let bootCount = 0
let stopSync: (() => void) | null = null

function startSync(): (() => void) | null {
  const api = compareApi()
  if (!api) return null
  const offChanged = api.onChanged((m) => applyManifest(m))
  const offEvents = onOpencodeEvent(handleEvent)
  const offReconnect = onStreamReconnect(rehydrateAll)
  // Si el motor aún no estaba listo al cargar, se hidrata cuando aparece el cliente.
  const offServer = useServer.subscribe((s, prev) => {
    if (s.client && s.client !== prev.client) rehydrateAll()
  })
  void loadCompare()
  return () => {
    offChanged()
    offEvents()
    offReconnect()
    offServer()
  }
}

/** Activa la sincronización (con cuenta de usos: la comparten Code y Chat). Devuelve la función que la libera. */
export function bootCompare(): () => void {
  if (isRemoteSurface() || !compareApi()) return () => undefined
  bootCount++
  if (bootCount === 1) stopSync = startSync()
  let done = false
  return () => {
    if (done) return
    done = true
    bootCount--
    if (bootCount === 0) {
      stopSync?.()
      stopSync = null
    }
  }
}

// ───────────────────────────── selección armada ─────────────────────────────

export function armModels(mode: CompareMode, directory: string | null, models: CompareModelRef[]): void {
  if (validateSelection(models) !== null) return
  set((s) => ({ armed: { ...s.armed, [ctxKey(mode, directory)]: models } }))
}

export function disarm(mode: CompareMode, directory: string | null): void {
  set((s) => {
    const armed = { ...s.armed }
    delete armed[ctxKey(mode, directory)]
    return { armed }
  })
}

export const isArmed = (mode: CompareMode, directory: string | null): boolean => !!get().armed[ctxKey(mode, directory)]

// ───────────────────────────── lanzamiento ─────────────────────────────

const SKIP_KEY = 'onyxcode.compare.skipConfirm'

export function readSkipConfirm(): boolean {
  try {
    return globalThis.localStorage?.getItem(SKIP_KEY) === '1'
  } catch {
    return false
  }
}

function writeSkipConfirm(on: boolean): void {
  try {
    if (on) globalThis.localStorage?.setItem(SKIP_KEY, '1')
    else globalThis.localStorage?.removeItem(SKIP_KEY)
  } catch {
    // sin almacenamiento: el aviso simplemente volverá a mostrarse
  }
}

export interface CompareRequestCtx {
  mode: CompareMode
  directory: string | null
  text: string
  attachments?: readonly unknown[]
  /** Modo de permisos de Code (`plan` no existe en una comparación: se usa `manual`). */
  permissionMode?: ComparePermissionMode | 'plan'
}

let confirmResolve: ((started: boolean) => void) | null = null

function settleConfirm(started: boolean): void {
  const r = confirmResolve
  confirmResolve = null
  set({ confirm: null })
  r?.(started)
}

const patchConfirm = (id: string, patch: Partial<ConfirmRequest>): void =>
  set((s) => (s.confirm && s.confirm.id === id ? { confirm: { ...s.confirm, ...patch } } : {}))

function newId(): string {
  const c = globalThis.crypto
  if (c && typeof c.randomUUID === 'function') return c.randomUUID()
  const hex = (n: number): string => Array.from({ length: n }, () => Math.floor(Math.random() * 16).toString(16)).join('')
  return `${hex(8)}-${hex(4)}-4${hex(3)}-a${hex(3)}-${hex(12)}`
}

/**
 * Gancho del compositor: si hay una comparación armada para este contexto, la envía en vez de un mensaje normal.
 * Devuelve `false` si no hay nada armado (el compositor sigue con su envío de siempre). Si hay, resuelve `true` cuando la
 * comparación arrancó y `false` si el usuario cancela o no se pudo lanzar (el borrador debe quedarse).
 */
export function requestCompare(ctx: CompareRequestCtx): Promise<boolean> {
  const api = compareApi()
  const models = get().armed[ctxKey(ctx.mode, ctx.directory)]
  if (!api || !models || get().confirm) return Promise.resolve(false)
  const id = newId()
  const permissionMode: ComparePermissionMode = !ctx.permissionMode || ctx.permissionMode === 'plan' ? 'manual' : ctx.permissionMode
  const busyNow = Object.values(get().manifests).some(isActiveManifest)
  let blocker: BlockerKind | null = null
  if (validateSelection(models) !== null) blocker = 'models'
  else if ((ctx.attachments?.length ?? 0) > 0) blocker = 'attachments'
  else if (busyNow) blocker = 'busy'
  else if (ctx.mode === 'code' && !ctx.directory) blocker = 'noRepo'
  const req: ConfirmRequest = {
    id,
    mode: ctx.mode,
    directory: ctx.directory,
    text: ctx.text,
    permissionMode,
    models,
    blocker,
    preflight: null,
    checking: ctx.mode === 'code' && blocker === null,
    spent: null,
    starting: false,
    error: null
  }
  return new Promise<boolean>((resolve) => {
    confirmResolve = resolve
    set({ confirm: req })
    if (blocker) return
    const client = useServer.getState().client
    if (client) {
      void loadGlobalUsage(client).then(
        (u) => patchConfirm(id, { spent: u.today.cost }),
        () => undefined
      )
    }
    if (ctx.mode === 'code' && ctx.directory) {
      void api.preflight(ctx.directory).then(
        (pf) => {
          if (get().confirm?.id !== id) return
          patchConfirm(id, { preflight: pf, checking: false, blocker: pf.repo ? null : 'noRepo' })
          // Con «No volver a mostrar» y nada que avisar (árbol limpio), se lanza directamente.
          if (pf.repo && pf.clean && readSkipConfirm()) void confirmStart()
        },
        (err) => patchConfirm(id, { checking: false, error: errText(err) })
      )
    } else if (readSkipConfirm()) {
      void confirmStart()
    }
  })
}

/** Variante síncrona del contrato acordado con el compositor de Code: `true` si se hizo cargo del envío. */
export function maybeInterceptSubmit(
  text: string,
  ctx: {
    mode: CompareMode
    directory: string | null
    attachments: readonly unknown[]
    permissionMode?: CompareRequestCtx['permissionMode']
    onStarted?: () => void
  }
): boolean {
  if (!compareApi() || !isArmed(ctx.mode, ctx.directory)) return false
  void requestCompare({
    mode: ctx.mode,
    directory: ctx.directory,
    text,
    attachments: ctx.attachments,
    permissionMode: ctx.permissionMode
  }).then((started) => {
    if (started) ctx.onStarted?.()
  })
  return true
}

export function cancelConfirm(): void {
  settleConfirm(false)
}

export async function confirmStart(opts?: { dontAsk?: boolean }): Promise<void> {
  const c = get().confirm
  const api = compareApi()
  if (!c || !api || c.starting || c.blocker || c.checking) return
  patchConfirm(c.id, { starting: true, error: null })
  try {
    const manifest = await api.start({
      id: c.id,
      mode: c.mode,
      ...(c.mode === 'code' && c.directory ? { cwd: c.directory } : {}),
      models: c.models,
      prompt: c.text,
      permissionMode: c.permissionMode
    })
    if (opts?.dontAsk) writeSkipConfirm(true)
    set((s) => ({
      origin: { ...s.origin, [manifest.id]: { mode: c.mode, directory: c.directory } },
      opened: { ...s.opened, [manifest.id]: true }
    }))
    disarm(c.mode, c.directory)
    applyManifest(manifest)
    settleConfirm(true)
  } catch (err) {
    patchConfirm(c.id, { starting: false, error: errText(err) })
  }
}

// ───────────────────────────── acciones sobre columnas ─────────────────────────────

function setBusy(key: string, what: string | undefined): void {
  set((s) => ({ busy: { ...s.busy, [key]: what } }))
}

function setError(id: string, message: string | undefined): void {
  set((s) => ({ errors: { ...s.errors, [id]: message } }))
}

export function pushNotice(mode: CompareMode, tone: Notice['tone'], text: string): void {
  set((s) => ({ notice: { seq: (s.notice?.seq ?? 0) + 1, mode, tone, text } }))
}
export const clearNotice = (): void => set({ notice: null })

export async function cancelColumn(id: string, index?: number): Promise<void> {
  const api = compareApi()
  if (!api) return
  const key = index === undefined ? `${id}:*` : colKey(id, index)
  setBusy(key, 'cancel')
  setError(id, undefined)
  try {
    await api.cancel(id, index)
  } catch (err) {
    setError(id, errText(err))
  } finally {
    setBusy(key, undefined)
  }
}

export async function retryColumn(id: string, index: number): Promise<void> {
  const api = compareApi()
  if (!api) return
  setBusy(colKey(id, index), 'retry')
  setError(id, undefined)
  try {
    await api.retry(id, index)
  } catch (err) {
    setError(id, errText(err))
  } finally {
    setBusy(colKey(id, index), undefined)
  }
}

export async function discardColumn(id: string, index: number): Promise<boolean> {
  const api = compareApi()
  if (!api) return false
  const key = colKey(id, index)
  setBusy(key, 'discard')
  setError(id, undefined)
  try {
    await api.discard(id, index)
    return true
  } catch (err) {
    setError(id, errText(err))
    return false
  } finally {
    setBusy(key, undefined)
  }
}

export async function loadDiff(id: string, index: number): Promise<void> {
  const api = compareApi()
  if (!api) return
  const key = colKey(id, index)
  set((s) => ({ diffs: { ...s.diffs, [key]: { status: 'loading' } } }))
  try {
    const diff = await api.diff(id, index)
    set((s) => ({ diffs: { ...s.diffs, [key]: { status: 'ready', diff } } }))
  } catch (err) {
    set((s) => ({ diffs: { ...s.diffs, [key]: { status: 'error', message: errText(err) } } }))
  }
}

export type KeepOutcome =
  | { kind: 'ok'; files: string[]; closed: boolean }
  | { kind: 'failed'; reason: AdoptFailure['reason']; files: string[] }
  | { kind: 'error'; message: string }

/**
 * «Quedarme con este»: adopta la columna y, si salió bien, cierra la comparación (main descarta las demás copias; en Chat la
 * sesión elegida queda como conversación normal). El fallo `dirty-overlap` se puede repetir con `force`.
 */
export async function keepColumn(id: string, index: number, force = false): Promise<KeepOutcome> {
  const api = compareApi()
  if (!api) return { kind: 'error', message: t('compare.error.generic') }
  const key = colKey(id, index)
  setBusy(key, 'adopt')
  setError(id, undefined)
  set((s) => ({ adoptFailures: { ...s.adoptFailures, [key]: undefined } }))
  try {
    const res = await api.adopt(id, index, force || undefined)
    if (!res.ok) {
      set((s) => ({ adoptFailures: { ...s.adoptFailures, [key]: { reason: res.reason, files: res.files } } }))
      return { kind: 'failed', reason: res.reason, files: res.files }
    }
    const closed = await closeCompare(id)
    return { kind: 'ok', files: res.files, closed }
  } catch (err) {
    const message = errText(err)
    setError(id, message)
    return { kind: 'error', message }
  } finally {
    setBusy(key, undefined)
  }
}

/** Cierra la comparación (main cancela lo que siga y descarta las copias). `false` = alguna copia se conserva. */
export async function closeCompare(id: string): Promise<boolean> {
  const api = compareApi()
  if (!api) return false
  setBusy(`${id}:*`, 'close')
  try {
    const res = await api.close(id)
    if (res.closed) {
      dropManifest(id)
      return true
    }
    setError(id, t('compare.close.kept'))
    return false
  } catch (err) {
    setError(id, errText(err))
    return false
  } finally {
    setBusy(`${id}:*`, undefined)
  }
}

export async function exportBench(id: string): Promise<void> {
  const api = compareApi()
  if (!api) return
  const m = get().manifests[id]
  setBusy(`${id}:*`, 'export')
  try {
    const res = await api.exportBench(id)
    if (res) pushNotice(m?.mode ?? 'code', 'info', t('compare.bench.saved', { path: res.path }))
  } catch (err) {
    setError(id, errText(err))
  } finally {
    setBusy(`${id}:*`, undefined)
  }
}

export function openComparison(id: string, directory: string | null): void {
  set((s) => ({
    opened: { ...s.opened, [id]: true },
    origin: { ...s.origin, [id]: s.origin[id] ?? { mode: s.manifests[id]?.mode ?? 'code', directory } }
  }))
}

// ───────────────────────────── selectores ─────────────────────────────

/** ¿La comparación pertenece a este contexto (modo y, en Code, carpeta)? */
export function belongsTo(s: Pick<CompareState, 'origin'>, m: CompareManifest, mode: CompareMode, directory: string | null): boolean {
  if (m.mode !== mode) return false
  if (mode === 'chat') return true
  const o = s.origin[m.id]
  return !!directory && (o?.directory === directory || m.cwd === directory)
}

/** La comparación con vista abierta en este contexto (la más reciente). */
export function selectShown(s: CompareState, mode: CompareMode, directory: string | null): CompareManifest | null {
  const list = Object.values(s.manifests)
    .filter((m) => s.opened[m.id] && belongsTo(s, m, mode, directory))
    .sort((a, b) => b.createdAt - a.createdAt)
  return list[0] ?? null
}

/** Comparaciones recuperadas (sin vista abierta) de este contexto: las ofrece la franja de recuperación. */
export function selectRecoverable(s: CompareState, mode: CompareMode, directory: string | null): CompareManifest[] {
  return Object.values(s.manifests)
    .filter((m) => !s.opened[m.id] && belongsTo(s, m, mode, directory))
    .sort((a, b) => b.createdAt - a.createdAt)
}

/**
 * ¿Debe ocultarse esta sesión de la lista de Chat? Las de una comparación sin elegir no son conversaciones todavía; la elegida
 * sí. Mientras no se hayan cargado los manifiestos se ocultan todas las marcadas (evita un parpadeo en la lista).
 */
export function isHiddenCompareSession(
  session: { id: string; metadata?: Record<string, unknown> | undefined },
  state: Pick<CompareState, 'manifests' | 'loaded'>
): boolean {
  const cid = session.metadata?.compare
  if (typeof cid !== 'string') return false
  const m = state.manifests[cid]
  if (!m) return !state.loaded
  const col = m.columns.find((c) => c.sessionID === session.id)
  return !(col && col.adopted)
}

/** Para pruebas: vuelve al estado inicial y suelta los buffers. */
export function resetCompareForTests(): void {
  stopSync?.()
  stopSync = null
  bootCount = 0
  watched.clear()
  hydrated.clear()
  closedIds.clear()
  buffers.orphanParts.clear()
  buffers.orphanDeltas.clear()
  buffers.loading.clear()
  buffers.seen.ids.clear()
  buffers.seen.order.length = 0
  confirmResolve = null
  queue.discard()
  useCompare.setState(initial(), true)
}
