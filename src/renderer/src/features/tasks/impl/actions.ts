/** Acciones del modo Tareas (carpetas, tareas, permisos). */
import type { PermissionRequest } from '@opencode-ai/sdk/v2/client'
import { getLang, t } from '@shared/i18n'
import { TASKS_TERMS } from '@shared/tasks-glossary'
import { type AccessDecision, type TasksFolderSet, type FolderAccessMode } from '@shared/ipc-tasks'
import { COMPUTER_AGENT_ID, TASKS_AGENT_ID } from '@shared/agents'
import { buildTasksSystemPrompt } from '@shared/tasks-prompt'
import { sandboxSendBlocked } from '@shared/sandbox-providers'
import { NO_AI_ERROR } from '@shared/ai-errors'
import type { ModelRef } from '@shared/types'
import { confirmDialog } from '../../../components/ConfirmDialog'
import { currentAiGate } from '../../../lib/ai-gate'
import { errorMessage } from '../../../lib/opencode'
import { useSessions } from '../../../stores/sessions'
import { useSettings } from '../../../stores/settings'
import { useUi } from '../../../stores/ui'
import { cw, hasTasksBridge } from './bridge'
import { folderModeLabel } from './folder-mode'
import { failedText, firstPoint, notCopiedWarningText, pickPointForMessage, restoreWarningText, type RestoreResult } from './restore-logic'
import {
  clearUnseen,
  connectFolder,
  currentTasksModel,
  currentTasksVariant,
  disconnect,
  forgetTaskMeta,
  fullAccessFor,
  loadGrants,
  loadProjectAndMemory,
  loadTask,
  refreshComputerStatus,
  rememberFolder,
  rememberFullAccess,
  rootTaskId,
  setTaskMeta,
  useTasks
} from './store'
import { CREATE_SKILL_PROMPT, buildContinuationPrompt, buildSideChatSystem, suggestedExportName, transcriptToMarkdown } from './transcript'
import { folderRequestPaths, isArchivedSession, rememberablePatterns } from './util'

// ── Red de Tareas (aviso "Se bloqueó el acceso a…") ──

/** Tras permitir un host, reanuda la tarea: la abre (si no es la activa) y le pide que reintente. */
export async function retryAfterNetworkAllow(taskId: string, host: string): Promise<void> {
  if (useTasks.getState().activeTaskId !== taskId) await openTask(taskId)
  await sendToTask(`Reintenta, ya tienes acceso a ${host}`, currentTasksModel()) // i18n-ignore: prompt al agente (se queda en español)
}

// ── "Permitir borrar" (Seatbelt: file-write-unlink) ──

/**
 * Concede/retira "Permitir borrar" para la carpeta actual. El proceso principal reinicia el
 * servidor sandboxeado para que el nuevo perfil Seatbelt tome efecto: si estaba en modo sandbox,
 * reconectamos (nuevo cliente/URL) y la tarea activa queda cerrada — el usuario debe reabrirla y
 * pedirle al agente que continúe.
 */
export async function setDeleteGrantAllowed(allowed: boolean): Promise<void> {
  const { folder, conn } = useTasks.getState()
  if (!folder) return
  useTasks.setState({ deleteGrantBusy: true })
  try {
    const now = await cw('tasks:deleteGrant:set', { folder, allowed })
    useTasks.setState({ deleteGrant: now })
    if (conn && !conn.fullAccess) await connectFolder(folder, false)
  } finally {
    useTasks.setState({ deleteGrantBusy: false })
  }
}

/** Agente a usar según el servidor conectado. */
export function currentAgent(): string {
  return useTasks.getState().conn?.fullAccess ? COMPUTER_AGENT_ID : TASKS_AGENT_ID
}

export async function loadFolders(): Promise<void> {
  try {
    useTasks.setState({ folders: await cw('tasks:listFolders') })
  } catch (err) {
    useTasks.setState({ error: errorMessage(err) })
  }
}

/** Abre el diálogo nativo; si la carpeta ya está autorizada, conecta; si no, pide confirmación. */
export async function chooseFolder(): Promise<void> {
  const picked = await cw('tasks:pickFolder')
  if (!picked) return
  useTasks.setState({ error: null })
  const { folders } = useTasks.getState()
  if (folders.some((f) => f.path === picked)) await selectFolder(picked)
  else useTasks.setState({ pendingApproval: picked })
}

export async function approvePending(): Promise<void> {
  const folder = useTasks.getState().pendingApproval
  if (!folder) return
  useTasks.setState({ error: null })
  try {
    const approved = await cw('tasks:approveFolder', { folder })
    useTasks.setState({ pendingApproval: null })
    await loadFolders()
    await selectFolder(approved.path)
  } catch (err) {
    useTasks.setState({ pendingApproval: null, error: errorMessage(err) })
  }
}

export function cancelPending(): void {
  useTasks.setState({ pendingApproval: null })
}

export async function selectFolder(folder: string): Promise<void> {
  const st = useTasks.getState()
  if (st.folder === folder && st.phase === 'ready' && st.fullAccess === fullAccessFor(folder)) return
  await connectFolder(folder)
}

/**
 * Cambia el modo de acceso de la carpeta actual. Pasar a Control total pide confirmación
 * (diálogo) salvo que `confirmed` sea true; volver a sandbox es inmediato.
 */
export async function setAccessMode(fullAccess: boolean, confirmed = false): Promise<void> {
  const { folder } = useTasks.getState()
  if (!folder) return
  if (fullAccess && !confirmed) {
    useTasks.setState({ pendingFullAccess: folder })
    return
  }
  useTasks.setState({ pendingFullAccess: null })
  // El consentimiento lo registra main (tasks:start {fullAccess} lo exige); volver a sandbox
  // lo retira y detiene el servidor sin sandbox.
  try {
    if (fullAccess) await cw('tasks:grantFullAccess', { folder })
    else await cw('tasks:revokeFullAccess', { folder })
  } catch (err) {
    useTasks.setState({ error: errorMessage(err) })
    if (fullAccess) return
  }
  rememberFullAccess(folder, fullAccess)
  await connectFolder(folder, fullAccess)
}

export function cancelFullAccess(): void {
  useTasks.setState({ pendingFullAccess: null })
}

export async function checkComputer(): Promise<void> {
  await refreshComputerStatus()
}

/** Abre los prompts de macOS / Ajustes › Privacidad y vuelve a comprobar. */
export async function requestComputerPermissions(): Promise<void> {
  await cw('computer:requestPermissions')
  await refreshComputerStatus()
}

/** Sesiones de la carpeta actual que están trabajando. */
function busySessionIds(): string[] {
  const { folder } = useTasks.getState()
  const { sessions, status } = useSessions.getState()
  return Object.keys(status).filter((id) => status[id] !== 'idle' && (!folder || sessions[id]?.directory === folder))
}

/** Aborta todas las tareas en curso de la carpeta (tras detener el control del Mac). */
export async function abortBusyTasks(): Promise<void> {
  const { client, folder, activeTaskId } = useTasks.getState()
  if (!client || !folder) return
  const ids = new Set(busySessionIds())
  if (activeTaskId) ids.add(activeTaskId)
  await Promise.all([...ids].map((sessionID) => client.session.abort({ sessionID, directory: folder }).catch(() => undefined)))
}

/**
 * Botón "Detener": el proceso principal activa el kill-switch, aborta las sesiones de TODOS los
 * servidores de Control total y mata los helpers (igual que ⌘⇧Esc y la píldora). El abort local es
 * solo redundancia por si main tardara.
 */
export async function stopComputerControl(): Promise<void> {
  useTasks.setState({ controlStoppedAt: Date.now() })
  await Promise.allSettled([cw('computer:stop'), abortBusyTasks()])
}

/** "Reanudar control": acción explícita del usuario tras una parada. */
export async function resumeComputerControl(): Promise<void> {
  await cw('computer:resume')
  useTasks.setState({ controlStoppedAt: null, lastAction: null })
}

// ── Concesión por app ──

/**
 * Responde a la tarjeta `request_access` pendiente: una decisión por app (nivel o "denegar"), o
 * `feedback` si el usuario pidió cambios ("Editar" en vez de aprobar: no se concede nada, el
 * texto vuelve al agente para que replantee el plan). `approvePlan` aprueba el plan aunque no se
 * conceda ninguna app (plan sin apps); `cancel` (Esc, ✕, "Cancelar") no toca ninguna concesión ni
 * aprueba nada. Persiste en main y desbloquea la herramienta MCP que esperaba la respuesta (que ya
 * no tiene límite de tiempo: puede llevar rato).
 */
export async function respondAccessRequest(
  decisions: Array<{ bundleId: string; name: string; decision: AccessDecision }>,
  opts: { feedback?: string; approvePlan?: boolean; cancel?: boolean } = {}
): Promise<void> {
  const req = useTasks.getState().accessRequest
  if (!req) return
  useTasks.setState({ accessRequest: null })
  const { feedback, approvePlan, cancel } = opts
  try {
    await cw('computer:respondAccess', { id: req.id, decisions, feedback, approvePlan, cancel })
  } catch (err) {
    useTasks.setState({ error: errorMessage(err) })
  }
  if (!feedback && !cancel) await loadGrants()
}

/** Esc / ✕ / "Cancelar": no concede, no deniega y no aprueba nada (las concesiones quedan como estaban). */
export function dismissAccessRequest(): void {
  void respondAccessRequest([], { cancel: true })
}

/** "Revocar": la siguiente acción del agente en esa tarea vuelve a pedir el plan. */
export async function revokePlanApproval(sessionId: string): Promise<void> {
  try {
    await cw('computer:revokePlan', { sessionId })
  } catch (err) {
    useTasks.setState({ error: errorMessage(err) })
  }
}

/** Cambia (o concede a mano) el nivel de una app desde Ajustes. */
export async function setAppGrant(bundleId: string, name: string, tier: 'view' | 'click' | 'full'): Promise<void> {
  try {
    const grants = await cw('computer:setGrant', { bundleId, name, tier })
    useTasks.setState({ grants })
  } catch (err) {
    useTasks.setState({ error: errorMessage(err) })
  }
}

/** Quita la concesión (vuelve a "sin decidir": se preguntará de nuevo la próxima vez). */
export async function revokeAppGrant(bundleId: string): Promise<void> {
  try {
    const grants = await cw('computer:revokeGrant', { bundleId })
    useTasks.setState({ grants })
  } catch (err) {
    useTasks.setState({ error: errorMessage(err) })
  }
}

export async function denyApp(bundleId: string, name: string): Promise<void> {
  try {
    const grants = await cw('computer:denyApp', { bundleId, name })
    useTasks.setState({ grants })
  } catch (err) {
    useTasks.setState({ error: errorMessage(err) })
  }
}

export async function undenyApp(bundleId: string): Promise<void> {
  try {
    const grants = await cw('computer:undenyApp', { bundleId })
    useTasks.setState({ grants })
  } catch (err) {
    useTasks.setState({ error: errorMessage(err) })
  }
}

/** Mensaje de error en el idioma activo (se evalúa al fallar el envío). */
export const controlStoppedSendError = (): string => t('tasks.act.stopped')

export async function forgetFolder(folder: string): Promise<void> {
  try {
    await cw('tasks:removeFolder', { folder })
    if (useTasks.getState().folder === folder) {
      disconnect()
      rememberFolder(null)
      useTasks.setState({ folder: null, activeTaskId: null })
    }
    await loadFolders()
  } catch (err) {
    useTasks.setState({ error: errorMessage(err) })
  }
}

export function newTask(): void {
  // Sin tarea activa se vuelve al modelo del modo Tareas (que `setTaskModel` ya recuerda).
  useTasks.setState({ activeTaskId: null, taskModel: null, taskVariant: null, sideChat: null })
}

/** Modelo y esfuerzo con que se usó la tarea por última vez (último mensaje del usuario, o el de la sesión). */
function taskModelOf(sessionID: string): { model: ModelRef; variant: string | null } | null {
  const st = useSessions.getState()
  const entries = st.messages[sessionID] ?? []
  for (let i = entries.length - 1; i >= 0; i--) {
    const info = entries[i].info
    if (info.role === 'user' && info.model) {
      return { model: { providerID: info.model.providerID, modelID: info.model.modelID }, variant: info.model.variant ?? null }
    }
  }
  const m = st.sessions[sessionID]?.model
  return m ? { model: { providerID: m.providerID, modelID: m.id }, variant: m.variant ?? null } : null
}

export async function openTask(sessionID: string): Promise<void> {
  useTasks.setState((s) => ({
    activeTaskId: sessionID,
    // La Consulta lateral pertenece a una tarea concreta.
    sideChat: s.sideChat && s.sideChat.taskId !== sessionID ? null : s.sideChat
  }))
  clearUnseen(sessionID)
  // Reabrir fija la sesión (activa + acceso) ANTES de cargar (LRU de `messages`).
  useSessions.getState().touchSession(sessionID)
  await loadTask(sessionID)
  // La tarea conserva su modelo y su esfuerzo al reabrirla.
  if (useTasks.getState().activeTaskId === sessionID) {
    const m = taskModelOf(sessionID)
    useTasks.setState({ taskModel: m?.model ?? null, taskVariant: m?.variant ?? null })
  }
}

function ctx(): { client: NonNullable<ReturnType<typeof useTasks.getState>['client']>; folder: string } {
  const { client, folder } = useTasks.getState()
  if (!client || !folder) throw new Error(t('tasks.act.serverNotReady'))
  return { client, folder }
}

/** Diálogo nativo para adjuntar archivos: se copian a la carpeta y quedan listos para el próximo mensaje. */
export async function attachFiles(): Promise<void> {
  const { folder } = useTasks.getState()
  if (!folder) throw new Error(t('tasks.act.pickFolderFirst'))
  const files = await cw('tasks:importFiles', { folder })
  if (files.length === 0) return
  useTasks.setState((s) => {
    const seen = new Set(s.attachments.map((a) => a.path))
    return { attachments: [...s.attachments, ...files.filter((f) => !seen.has(f.path))] }
  })
}

export function removeAttachment(path: string): void {
  useTasks.setState((s) => ({ attachments: s.attachments.filter((a) => a.path !== path) }))
}

/** Carpetas adicionales (vinculadas y de confianza) de la carpeta actual; solo aplican en sandbox. */
function extraFolders(): Array<{ path: string; mode: FolderAccessMode; trusted?: boolean }> {
  const { folderSet, conn } = useTasks.getState()
  if (!folderSet || conn?.fullAccess) return []
  const out: Array<{ path: string; mode: FolderAccessMode; trusted?: boolean }> = []
  const seen = new Set<string>()
  for (const f of folderSet.linked) {
    seen.add(f.path)
    out.push({ path: f.path, mode: f.mode })
  }
  for (const f of folderSet.trusted) {
    if (!seen.has(f.path)) out.push({ path: f.path, mode: f.mode, trusted: true })
  }
  return out
}

/**
 * Prompt de sistema extra: instrucciones generales (Ajustes) + proyecto (instrucciones, enlaces) + memoria
 * (`.onyxcode/memoria.md`, si está activada) + carpetas adicionales. Lo arma el módulo compartido con main
 * (rutinas). `undefined` si no hay nada que añadir.
 */
function buildSystemPrompt(): string | undefined {
  const { project, memory } = useTasks.getState()
  return buildTasksSystemPrompt({
    globalInstructions: useSettings.getState().settings.tasksGlobalInstructions,
    project,
    memory: memory?.content,
    folders: extraFolders(),
    lang: getLang()
  })
}

/** Texto final del mensaje con la lista de adjuntos (rutas relativas a la carpeta). */
function withAttachments(text: string): string {
  const files = useTasks.getState().attachments
  if (files.length === 0) return text
  const list = files.map((f) => `- ${f.relPath}`).join('\n')
  return `${text}\n\nArchivos adjuntos (ya copiados en la carpeta de la tarea):\n${list}` // i18n-ignore: prompt al agente (se queda en español)
}

/**
 * Envía un mensaje; si no hay tarea activa, crea una nueva sesión con el agente `tasks`/`computer`.
 * `model` (por defecto `currentTasksModel()`) y `opts.variant` (esfuerzo; por defecto el de la tarea)
 * quedan guardados en la sesión; `metadata.folders` recuerda las carpetas adicionales de la tarea.
 */
export async function sendToTask(rawText: string, model?: ModelRef, opts?: { variant?: string }): Promise<void> {
  const { client, folder } = ctx()
  // Sandbox: el servidor solo tiene OpenCode Go; con un modelo de otro proveedor, error claro (no fallo silencioso).
  // Modelo efectivo contra las IA conectadas (globales): sin ninguna, no se envía; no se persiste nada.
  const wanted = model ?? currentTasksModel()
  const aiGate = currentAiGate(wanted)
  if (aiGate.gate.blocked || !aiGate.effective) throw NO_AI_ERROR
  const sendModel = aiGate.effective
  const conn0 = useTasks.getState().conn
  if (conn0 && conn0.sandboxed && !conn0.fullAccess) {
    const providers = await client.config.providers({ directory: folder }).catch(() => null)
    const available = providers?.data ? providers.data.providers.map((p) => p.id) : null
    const blocked = sandboxSendBlocked(available, sendModel.providerID)
    if (blocked) throw new Error(blocked)
  }
  if (useTasks.getState().conn?.fullAccess === true) {
    // Tras una parada NO se reanuda solo: hace falta "Reanudar control" (estado en main).
    const st = await cw('computer:state').catch(() => null)
    const stopped = st ? st.stopped : !!useTasks.getState().controlStoppedAt
    useTasks.setState({ controlStoppedAt: stopped ? (st?.stoppedAt ?? Date.now()) : null })
    if (stopped) throw new Error(controlStoppedSendError())
  }
  // La memoria (`.onyxcode/memoria.md`) puede haber cambiado desde que se conectó: se relee antes de armar el prompt.
  await loadProjectAndMemory(folder)
  const text = withAttachments(rawText)
  useTasks.setState({ attachments: [], draft: '' })
  const useModel = sendModel
  const variant = opts?.variant ?? currentTasksVariant()
  const sessions = useSessions.getState()
  let sessionID = useTasks.getState().activeTaskId
  if (!sessionID) {
    const folders = extraFolders()
    const res = await client.session.create({
      directory: folder,
      agent: currentAgent(),
      title: rawText.slice(0, 80),
      model: { id: useModel.modelID, providerID: useModel.providerID, ...(variant ? { variant } : {}) },
      metadata: {
        mode: 'tasks',
        fullAccess: useTasks.getState().conn?.fullAccess === true,
        ...(folders.length > 0 ? { folders: folders.map((f) => ({ path: f.path, mode: f.mode })) } : {})
      }
    })
    if (res.error || !res.data) throw new Error(errorMessage(res.error))
    sessions.upsertSession(res.data)
    sessionID = res.data.id
    const id = sessionID
    useSessions.setState((s) => ({ messages: { ...s.messages, [id]: s.messages[id] ?? [] }, loaded: { ...s.loaded, [id]: true } }))
    useTasks.setState({ activeTaskId: id })
  }
  const fullAccess = useTasks.getState().conn?.fullAccess === true
  if (fullAccess) useTasks.setState({ lastAction: null })
  // Punto de restauración: copia de la carpeta justo antes de que el agente toque nada. Si falla o
  // se salta, el mensaje se envía igualmente y se avisa en la conversación.
  await saveRestorePoint(folder, sessionID, rawText.slice(0, 80))
  sessions.touchSession(sessionID)
  sessions.setError(sessionID, null)
  sessions.setStatus(sessionID, 'busy')
  const res = await client.session.promptAsync({
    sessionID,
    directory: folder,
    agent: fullAccess ? COMPUTER_AGENT_ID : TASKS_AGENT_ID,
    model: { providerID: useModel.providerID, modelID: useModel.modelID },
    ...(variant ? { variant } : {}),
    system: buildSystemPrompt(),
    parts: [{ type: 'text', text }]
  })
  if (res.error) {
    sessions.setStatus(sessionID, 'idle')
    sessions.setError(sessionID, errorMessage(res.error))
  }
}

// ── Puntos de restauración ──

function setRestoreWarning(sessionId: string, text: string | null): void {
  useTasks.setState((s) => {
    const restoreWarning = { ...s.restoreWarning }
    if (text) restoreWarning[sessionId] = text
    else delete restoreWarning[sessionId]
    return { restoreWarning }
  })
}

const RESTORE_SEND_GUARD_MS = 35_000

/** Crea el punto previo al envío. Nunca lanza: un fallo solo deja un aviso en la conversación. */
async function saveRestorePoint(folder: string, sessionId: string, label: string): Promise<void> {
  if (!hasTasksBridge()) return
  setRestoreWarning(sessionId, null)
  // Un mensaje nuevo cierra el «Cambios deshechos…» anterior: su «Rehacer» ya no tendría sentido.
  useTasks.setState((s) => ({ restoreSaving: true, ...(s.restoreResult?.taskId === sessionId ? { restoreResult: null } : {}) }))
  try {
    // Main ya limita crear a 30 s (queda «omitido»); esta cota evita que un main colgado retenga el envío.
    const point = await Promise.race([
      cw('tasks:restore:create', { folder, sessionId, label }),
      new Promise<null>((r) => setTimeout(() => r(null), RESTORE_SEND_GUARD_MS))
    ])
    if (!point) setRestoreWarning(sessionId, restoreWarningText('tardaba demasiado'))
    else if (point.status !== 'ok') setRestoreWarning(sessionId, restoreWarningText(point.reason ?? 'motivo desconocido'))
    else if (point.notCopied) setRestoreWarning(sessionId, notCopiedWarningText(point.notCopied))
  } catch (err) {
    setRestoreWarning(sessionId, restoreWarningText(errorMessage(err)))
  } finally {
    useTasks.setState((s) => ({ restoreSaving: false, restoreVersion: s.restoreVersion + 1 }))
  }
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** Aplica un punto; si el monitor aún ve la carpeta ocupada (sondeo cada 3 s) espera y reintenta. */
async function applyRestorePoint(folder: string, pointId: string, paths?: string[]): ReturnType<typeof applyOnce> {
  for (let i = 0; ; i++) {
    try {
      return await applyOnce(folder, pointId, paths)
    } catch (err) {
      if (i < 6 && /sigue trabajando/.test(errorMessage(err))) {
        await sleep(1500)
        continue
      }
      throw err
    }
  }
}
function applyOnce(folder: string, pointId: string, paths?: string[]) {
  return cw('tasks:restore:apply', { folder, pointId, ...(paths ? { paths } : {}) })
}

async function listRestorePoints(folder: string, taskId: string) {
  return cw('tasks:restore:list', { folder, sessionId: taskId })
}

function messageCreatedAt(taskId: string, messageId: string): number | null {
  const e = (useSessions.getState().messages[taskId] ?? []).find((m) => m.info.id === messageId)
  return e ? e.info.time.created : null
}

async function stopIfBusy(taskId: string): Promise<void> {
  const { client, folder } = ctx()
  const run = useSessions.getState().status[taskId]
  if (run && run !== 'idle') {
    await client.session.abort({ sessionID: taskId, directory: folder }).catch(() => undefined)
    await waitUntilIdle(taskId)
  }
}

/** «Deshacer los cambios de esta tarea»: vuelve la carpeta a como estaba antes del primer mensaje. */
export async function undoTaskChanges(taskId: string): Promise<void> {
  const { folder } = ctx()
  const point = firstPoint(await listRestorePoints(folder, taskId))
  if (!point) throw new Error(t('tasks.act.noRestorePoint'))
  const res = await applyRestorePoint(folder, point.id)
  useTasks.setState((s) => ({
    restoreVersion: s.restoreVersion + 1,
    restoreResult: {
      taskId,
      kind: 'undone',
      restored: res.restored,
      trashed: res.trashed,
      failed: res.failed,
      undoPointId: res.undoPointId
    }
  }))
}

/** «Deshacer desde aquí»: restaura los archivos al punto de ese mensaje y oculta los mensajes posteriores. */
export async function undoFromMessage(taskId: string, userMessageId: string): Promise<void> {
  const { client, folder } = ctx()
  if (useTasks.getState().activeTaskId !== taskId) await openTask(taskId)
  const at = messageCreatedAt(taskId, userMessageId)
  const point = at === null ? null : pickPointForMessage(await listRestorePoints(folder, taskId), at)
  if (!point) throw new Error(t('tasks.act.noRestorePointMsg'))
  await stopIfBusy(taskId)
  const res = await applyRestorePoint(folder, point.id)
  const rev = await client.session.revert({ sessionID: taskId, directory: folder, messageID: userMessageId })
  if (rev.error) throw new Error(errorMessage(rev.error))
  if (rev.data) useSessions.getState().upsertSession(rev.data)
  await loadTask(taskId)
  useTasks.setState((s) => ({
    restoreVersion: s.restoreVersion + 1,
    restoreResult: {
      taskId,
      kind: 'undone',
      restored: res.restored,
      trashed: res.trashed,
      failed: res.failed,
      undoPointId: res.undoPointId,
      revertedMessageId: userMessageId
    }
  }))
}

/** «Rehacer»: aplica el punto «Antes de deshacer» (y recupera los mensajes ocultos, si los había). */
export async function redoRestore(): Promise<void> {
  const { client, folder } = ctx()
  const prev: RestoreResult | null = useTasks.getState().restoreResult
  if (!prev || prev.kind !== 'undone') return
  const res = await applyRestorePoint(folder, prev.undoPointId)
  if (prev.revertedMessageId) {
    const un = await client.session.unrevert({ sessionID: prev.taskId, directory: folder })
    if (un.error) throw new Error(errorMessage(un.error))
    if (un.data) useSessions.getState().upsertSession(un.data)
    await loadTask(prev.taskId)
  }
  useTasks.setState((s) => ({
    restoreVersion: s.restoreVersion + 1,
    restoreResult: {
      taskId: prev.taskId,
      kind: 'redone',
      restored: res.restored,
      trashed: res.trashed,
      failed: res.failed,
      undoPointId: res.undoPointId
    }
  }))
}

export async function abortTask(): Promise<void> {
  const { activeTaskId } = useTasks.getState()
  if (!activeTaskId) return
  const { client, folder } = ctx()
  await client.session.abort({ sessionID: activeTaskId, directory: folder })
}

export async function replyPermission(requestID: string, reply: 'once' | 'always' | 'reject', message?: string): Promise<void> {
  const { client, folder } = ctx()
  const res = await client.permission.reply({ requestID, directory: folder, reply, ...(message ? { message } : {}) })
  if (res.error) throw new Error(errorMessage(res.error))
  useTasks.setState((s) => {
    const permissions = { ...s.permissions }
    delete permissions[requestID]
    return { permissions }
  })
}

/** Responde una pregunta estructurada (una respuesta -array de labels seleccionados o texto libre- por pregunta). */
export async function replyQuestion(requestID: string, answers: string[][]): Promise<void> {
  const { client, folder } = ctx()
  const res = await client.question.reply({ requestID, directory: folder, answers })
  if (res.error) throw new Error(errorMessage(res.error))
  useTasks.setState((s) => {
    const questions = { ...s.questions }
    delete questions[requestID]
    return { questions }
  })
}

export async function rejectQuestion(requestID: string): Promise<void> {
  const { client, folder } = ctx()
  const res = await client.question.reject({ requestID, directory: folder })
  if (res.error) throw new Error(errorMessage(res.error))
  useTasks.setState((s) => {
    const questions = { ...s.questions }
    delete questions[requestID]
    return { questions }
  })
}

export async function archiveTask(sessionID: string): Promise<void> {
  const { client, folder } = ctx()
  const res = await client.session.update({ sessionID, directory: folder, time: { archived: Date.now() } })
  if (res.error) throw new Error(errorMessage(res.error))
  if (res.data) useSessions.getState().upsertSession(res.data)
  if (useTasks.getState().activeTaskId === sessionID) useTasks.setState({ activeTaskId: null })
  // Una tarea archivada no debe conservar su plan aprobado.
  void cw('computer:revokePlan', { sessionId: sessionID }).catch(() => {})
}

/** Renombra una tarea (título mostrado en la lista; no cambia el prompt original). */
export async function renameTask(sessionID: string, title: string): Promise<void> {
  const { client, folder } = ctx()
  const trimmed = title.trim()
  if (!trimmed) return
  const res = await client.session.update({ sessionID, directory: folder, title: trimmed })
  if (res.error) throw new Error(errorMessage(res.error))
  if (res.data) useSessions.getState().upsertSession(res.data)
  // Si main conoce la tarea (fijada / en un grupo), su título se mantiene al día.
  if (useTasks.getState().taskMeta[sessionID]) void setTaskMeta(sessionID, { title: trimmed })
}

/** Borra una tarea (y su historial) de forma permanente. */
export async function deleteTask(sessionID: string): Promise<void> {
  const { client, folder } = ctx()
  const res = await client.session.delete({ sessionID, directory: folder })
  if (res.error) throw new Error(errorMessage(res.error))
  // `removeSession` limpia sessions/messages/sessionSource/loaded/lastAccess; status y errors se limpian aquí también
  // (no dejar entradas huérfanas de una tarea borrada, F7-B36).
  useSessions.getState().removeSession(sessionID)
  useSessions.setState((s) => {
    const status = { ...s.status }
    const errors = { ...s.errors }
    delete status[sessionID]
    delete errors[sessionID]
    return { status, errors }
  })
  if (useTasks.getState().activeTaskId === sessionID) useTasks.setState({ activeTaskId: null })
  void cw('computer:revokePlan', { sessionId: sessionID }).catch(() => {})
  forgetTaskMeta(sessionID)
  void cw('tasks:restore:forget', { sessionId: sessionID }).catch(() => {})
  setRestoreWarning(sessionID, null)
  if (useTasks.getState().restoreResult?.taskId === sessionID) useTasks.setState({ restoreResult: null })
}

/**
 * "Programar esta tarea": abre el editor de rutinas (modo Rutinas) prellenado con la
 * instrucción original, la carpeta, el modo tasks y el modelo, enlazando la rutina a esta
 * tarea (`originSessionId`) para poder mostrar sus ejecuciones en el panel de la tarea.
 */
export async function scheduleActiveTask(): Promise<void> {
  const { activeTaskId, folder } = useTasks.getState()
  if (!activeTaskId || !folder) return
  const entries = useSessions.getState().messages[activeTaskId] ?? []
  const firstUser = entries.find((e) => e.info.role === 'user')
  const firstUserParts = firstUser?.parts ?? []
  const raw = firstUserParts
    .filter((p): p is Extract<(typeof firstUserParts)[number], { type: 'text' }> => p.type === 'text' && !p.synthetic)
    .map((p) => p.text)
    .join('\n')
  const markerIdx = raw.indexOf('\n\nArchivos adjuntos (ya copiados en la carpeta de la tarea):\n') // i18n-ignore: prompt al agente (se queda en español)
  const prompt = (markerIdx >= 0 ? raw.slice(0, markerIdx) : raw).trim()
  const title = useSessions.getState().sessions[activeTaskId]?.title || t('tasks.act.scheduledTitle')
  const model = currentTasksModel()
  const { openEditor } = await import('../../routines/impl/store')
  const { useUi } = await import('../../../stores/ui')
  openEditor(
    {
      name: title.slice(0, 200),
      prompt: prompt || title,
      mode: 'tasks',
      folder,
      model,
      schedule: { kind: 'daily', time: '09:00' },
      enabled: true,
      originSessionId: activeTaskId
    },
    t('tasks.act.scheduleHint')
  )
  useUi.getState().setMode('routines')
}

export async function reveal(path: string): Promise<void> {
  await cw('tasks:reveal', { path })
}

export async function openPath(path: string): Promise<void> {
  await cw('tasks:openPath', { path })
}

// ───────────────────────────── Carpetas adicionales (Lote B) ─────────────────────────────

/** Tareas raíz del servidor conectado que están trabajando (opcionalmente sin contar `exceptId`). */
function runningRootIds(exceptId?: string): string[] {
  const { conn, folder } = useTasks.getState()
  if (!conn || !folder) return []
  const { sessions, status, sessionSource } = useSessions.getState()
  return Object.keys(status).filter((id) => {
    const run = status[id]
    const sess = sessions[id]
    return (
      id !== exceptId &&
      (run === 'busy' || run === 'retry') &&
      !!sess &&
      !sess.parentID &&
      sess.directory === folder &&
      sessionSource[id] === conn.baseUrl
    )
  })
}

/** Cambiar las carpetas del sandbox reinicia su servidor: pide confirmación si hay otras tareas en curso. */
async function confirmInterruptRunning(exceptId?: string): Promise<boolean> {
  const n = runningRootIds(exceptId).length
  if (n === 0) return true
  return confirmDialog({
    title: t('tasks.act.interruptTitle'),
    message: t('tasks.act.interruptMsg', { count: n }),
    confirmLabel: t('tasks.act.interruptContinue'),
    danger: true
  })
}

function setFolderSetFrom(folder: string, res: TasksFolderSet): void {
  if (useTasks.getState().folder !== folder) return
  useTasks.setState({ folderSet: { primary: res.primary, linked: res.linked, trusted: res.trusted, applied: res.applied } })
}

/**
 * Vincula una carpeta adicional (y con `trust` la marca de confianza) a la carpeta actual. Si el sandbox
 * está en marcha main lo reinicia (las tareas en curso se interrumpen: se pide confirmación) y aquí se
 * reconecta. Los errores se muestran en `useTasks.error`. Devuelve true si se aplicó.
 */
export async function linkFolder(path: string, mode: FolderAccessMode, opts?: { trust?: boolean }): Promise<boolean> {
  const { folder, conn } = useTasks.getState()
  if (!folder) return false
  try {
    const sandbox = !!conn && !conn.fullAccess
    if (sandbox && !(await confirmInterruptRunning())) return false
    const chk = await cw('tasks:folders:check', { path })
    if (!chk.ok) throw new Error(chk.reason ?? t('tasks.act.cannotAddFolder'))
    const res = await cw('tasks:folders:link', {
      folder,
      path: chk.normalized,
      mode,
      restart: true,
      ...(opts?.trust !== undefined ? { trust: opts.trust } : {})
    })
    setFolderSetFrom(folder, res)
    if (res.restarted && sandbox) await connectFolder(folder, false)
    return true
  } catch (err) {
    useTasks.setState({ error: errorMessage(err) })
    return false
  }
}

/** Quita una carpeta adicional de la carpeta actual (reinicia el sandbox si está en marcha). */
export async function unlinkFolder(path: string): Promise<void> {
  const { folder, conn } = useTasks.getState()
  if (!folder) return
  try {
    const sandbox = !!conn && !conn.fullAccess
    if (sandbox && !(await confirmInterruptRunning())) return
    const res = await cw('tasks:folders:unlink', { folder, path, restart: true })
    setFolderSetFrom(folder, res)
    if (res.restarted && sandbox) await connectFolder(folder, false)
  } catch (err) {
    useTasks.setState({ error: errorMessage(err) })
  }
}

export type FolderRequestDecision =
  { kind: 'deny' } | { kind: 'later' } | { kind: 'allow'; path: string; mode: FolderAccessMode; trust: boolean }

/** Texto de rechazo que recibe el agente cuando el usuario no concede la carpeta. */
function folderRefusal(kind: 'deny' | 'later', path: string): string {
  return kind === 'deny'
    ? `El usuario denegó el acceso a ${path}; no lo vuelvas a pedir; adapta el plan para trabajar sin esa carpeta.` // i18n-ignore: prompt al agente (se queda en español)
    : `El usuario prefiere no dar acceso a ${path} por ahora; sigue sin esa carpeta y menciónalo en el resumen.` // i18n-ignore: prompt al agente (se queda en español)
}

/**
 * Responde a la tarjeta «quiere trabajar en otra carpeta» (permiso `external_directory`).
 * - Denegar / Ahora no: rechaza con un mensaje que orienta al agente.
 * - Permitir en Control total: `once`, o `always` + carpeta de confianza si se marcó «No volver a preguntar».
 * - Permitir en sandbox: la carpeta hay que vincularla y reiniciar el servidor (Seatbelt fija el perfil al
 *   lanzarlo): se confirma si hay otras tareas en curso, se rechaza la petición («se está concediendo
 *   acceso»), se vincula con reinicio, se reconecta y se le pide a la tarea que continúe sola.
 */
export async function answerFolderRequest(req: PermissionRequest, d: FolderRequestDecision): Promise<void> {
  const { conn, folder } = useTasks.getState()
  if (!conn || !folder) return
  const requested = folderRequestPaths(req).requested
  try {
    if (d.kind !== 'allow') {
      await replyPermission(req.id, 'reject', folderRefusal(d.kind, requested || 'esa carpeta'))
      return
    }
    if (conn.fullAccess) {
      if (d.trust) {
        await cw('tasks:trusted:set', { path: d.path, mode: d.mode })
        await replyPermission(req.id, 'always')
      } else {
        await replyPermission(req.id, 'once')
      }
      return
    }
    // Sandbox.
    const taskId = rootTaskId(req.sessionID)
    if (!(await confirmInterruptRunning(taskId))) return
    const chk = await cw('tasks:folders:check', { path: d.path })
    if (!chk.ok) throw new Error(chk.reason ?? t('tasks.act.cannotAddFolder'))
    await replyPermission(req.id, 'reject', 'Se está concediendo acceso; la tarea se reanudará sola.') // i18n-ignore: prompt al agente (se queda en español)
    const res = await cw('tasks:folders:link', { folder, path: chk.normalized, mode: d.mode, trust: d.trust, restart: true })
    setFolderSetFrom(folder, res)
    if (res.restarted) {
      await connectFolder(folder, false)
      if (useTasks.getState().phase !== 'ready') return
    }
    await openTask(taskId)
    await sendToTask(
      `Ya tienes acceso a ${chk.normalized} (${folderModeLabel(d.mode).toLowerCase()}). Continúa la tarea donde la dejaste.` // i18n-ignore: prompt al agente (se queda en español)
    )
  } catch (err) {
    useTasks.setState({ error: errorMessage(err) })
  }
}

/**
 * «Siempre»: responde `always` en OpenCode y guarda la regla en main (`tasks:rules:add`) para que valga al
 * reabrir la carpeta. No se guardan `external_directory`, `doom_loop`, `computer_*` ni patrones de borrado
 * (solo vale para esta sesión). Con `policy.disableAlwaysAllow` se responde solo `once`.
 */
export async function replyPermissionAlways(req: PermissionRequest): Promise<void> {
  const { folder, policy } = useTasks.getState()
  if (policy?.disableAlwaysAllow) {
    await replyPermission(req.id, 'once')
    return
  }
  await replyPermission(req.id, 'always')
  const patterns = rememberablePatterns(req)
  if (folder && patterns.length > 0) {
    cw('tasks:rules:add', { folder, permission: req.permission, patterns }).catch(() => undefined)
  }
}

// ───────────────────────────── Conversación: editar, continuar, exportar ─────────────────────────────

/** Espera (hasta `ms`) a que la tarea deje de estar ocupada, consultando al servidor. */
async function waitUntilIdle(taskId: string, ms = 4000): Promise<void> {
  const { client, folder } = ctx()
  const until = Date.now() + ms
  while (Date.now() < until) {
    const res = await client.session.status({ directory: folder }).catch(() => null)
    const t = res?.data?.[taskId]?.type
    if (!t || t === 'idle') {
      useSessions.getState().setStatus(taskId, 'idle')
      return
    }
    await new Promise((r) => setTimeout(r, 250))
  }
}

/**
 * «Editar y reintentar»: aborta si la tarea está trabajando, restaura los archivos al punto de ese
 * turno (si se guardó uno), deshace la conversación desde ese mensaje (`session.revert`), recarga y
 * envía el texto nuevo.
 */
export async function editAndRetry(taskId: string, userMessageId: string, text: string): Promise<void> {
  const trimmed = text.trim()
  if (!trimmed) return
  const { client, folder } = ctx()
  if (useTasks.getState().activeTaskId !== taskId) await openTask(taskId)
  await stopIfBusy(taskId)
  const at = messageCreatedAt(taskId, userMessageId)
  const point = at === null ? null : pickPointForMessage(await listRestorePoints(folder, taskId).catch(() => []), at)
  const restored = point ? await applyRestorePoint(folder, point.id) : null
  const res = await client.session.revert({ sessionID: taskId, directory: folder, messageID: userMessageId })
  if (res.error) throw new Error(errorMessage(res.error))
  if (res.data) useSessions.getState().upsertSession(res.data)
  await loadTask(taskId)
  await sendToTask(trimmed)
  if (restored && restored.failed.length > 0) setRestoreWarning(taskId, failedText(restored.failed))
}

async function ensureEntries(taskId: string): Promise<import('../../../stores/sessions').MessageEntry[]> {
  // `loaded` y no la presencia/longitud de la lista: puede ser parcial por eventos sueltos (F6-B14).
  if (!useSessions.getState().loaded[taskId]) await loadTask(taskId)
  return useSessions.getState().messages[taskId] ?? []
}

/** «Continuar en una tarea nueva»: nueva tarea (mismo modelo) con el encargo original y lo último concluido. */
export async function continueInNewTask(taskId: string): Promise<void> {
  const entries = await ensureEntries(taskId)
  const title = useSessions.getState().sessions[taskId]?.title ?? ''
  const prompt = buildContinuationPrompt(title, entries)
  const m = taskModelOf(taskId)
  newTask()
  if (m) useTasks.setState({ taskModel: m.model, taskVariant: m.variant })
  await sendToTask(prompt)
}

/** «Exportar a Markdown»: guarda la conversación con el diálogo de main. Devuelve la ruta (null si se canceló). */
export async function exportTaskMarkdown(taskId: string): Promise<string | null> {
  const entries = await ensureEntries(taskId)
  const session = useSessions.getState().sessions[taskId]
  if (!session) return null
  const content = transcriptToMarkdown(session, entries)
  return cw('tasks:exportMarkdown', { suggestedName: suggestedExportName(session.title), content })
}

/** «Crear skill de esta tarea»: le pide a la propia tarea que guarde `.opencode/skills/<nombre>/SKILL.md`. */
export async function createSkillFromTask(taskId: string): Promise<void> {
  if (useTasks.getState().activeTaskId !== taskId) await openTask(taskId)
  await sendToTask(CREATE_SKILL_PROMPT)
}

// ───────────────────────────── Consulta lateral ─────────────────────────────

/** Abre la Consulta lateral de la tarea (la sesión hija se crea con el primer mensaje). */
export function openSideChat(taskId: string): void {
  useTasks.setState((s) => (s.sideChat?.taskId === taskId ? s : { sideChat: { taskId, sessionId: null } }))
}

/**
 * Pregunta algo sobre la tarea sin modificarla: sesión hija (`parentID`, no sale en la lista) con el agente
 * `chat`, cuyo `system` lleva la conversación de la tarea condensada.
 */
export async function sendSideChat(text: string): Promise<void> {
  const trimmed = text.trim()
  const side = useTasks.getState().sideChat
  if (!trimmed || !side) return
  const { client, folder } = ctx()
  const sessions = useSessions.getState()
  let sessionID = side.sessionId
  if (!sessionID) {
    const res = await client.session.create({ directory: folder, parentID: side.taskId, title: TASKS_TERMS.sideChat, agent: 'chat' })
    if (res.error || !res.data) throw new Error(errorMessage(res.error))
    sessions.upsertSession(res.data)
    sessionID = res.data.id
    const id = sessionID
    useSessions.setState((s) => ({ messages: { ...s.messages, [id]: s.messages[id] ?? [] }, loaded: { ...s.loaded, [id]: true } }))
    useTasks.setState((s) => (s.sideChat?.taskId === side.taskId ? { sideChat: { taskId: side.taskId, sessionId: id } } : {}))
  }
  const entries = await ensureEntries(side.taskId)
  const title = useSessions.getState().sessions[side.taskId]?.title ?? ''
  const model = currentTasksModel()
  const variant = currentTasksVariant()
  sessions.setError(sessionID, null)
  sessions.setStatus(sessionID, 'busy')
  const res = await client.session.promptAsync({
    sessionID,
    directory: folder,
    agent: 'chat',
    model: { providerID: model.providerID, modelID: model.modelID },
    ...(variant ? { variant } : {}),
    system: buildSideChatSystem(title, entries),
    parts: [{ type: 'text', text: trimmed }]
  })
  if (res.error) {
    sessions.setStatus(sessionID, 'idle')
    sessions.setError(sessionID, errorMessage(res.error))
  }
}

/** Cierra la Consulta lateral (aborta la respuesta en curso; la sesión hija se conserva). */
export function closeSideChat(): void {
  const side = useTasks.getState().sideChat
  useTasks.setState({ sideChat: null })
  const { client, folder } = useTasks.getState()
  if (side?.sessionId && client && folder) {
    const run = useSessions.getState().status[side.sessionId]
    if (run && run !== 'idle') void client.session.abort({ sessionID: side.sessionId, directory: folder }).catch(() => undefined)
  }
}

// ───────────────────────────── Archivadas, grupos y navegación ─────────────────────────────

/**
 * Restaura una tarea archivada con `session.update({time:{archived:0}})`. Si el servidor lo rechaza o la
 * sesión sigue archivada, respaldo: `metadata.unarchivedAt` (ver `isArchivedSession`).
 */
export async function restoreTask(sessionId: string): Promise<void> {
  const { client, folder } = ctx()
  const known = useSessions.getState().sessions[sessionId]
  const first = await client.session.update({ sessionID: sessionId, directory: folder, time: { archived: 0 } })
  let data = first.error ? undefined : first.data
  if (!data || isArchivedSession(data)) {
    const second = await client.session.update({
      sessionID: sessionId,
      directory: folder,
      metadata: { ...(data?.metadata ?? known?.metadata ?? {}), unarchivedAt: Date.now() }
    })
    if (second.error) throw new Error(errorMessage(second.error))
    data = second.data ?? data
  }
  if (data) useSessions.getState().upsertSession(data)
}

/** «Mover a grupo…»: asigna (o quita con `null`/vacío) el grupo de la tarea. Persistido en main. */
export async function moveTaskToGroup(sessionId: string, group: string | null): Promise<void> {
  const clean = group?.trim().slice(0, 80) || null
  await setTaskMeta(sessionId, { group: clean })
}

/** Abre una tarea de cualquier carpeta/modo (vistas «Fijadas»/«Activas»): cambia a Tareas y conecta si hace falta. */
export async function openTaskAnywhere(t: { sessionId: string; folder: string; fullAccess: boolean }): Promise<void> {
  useUi.getState().openSettings(false)
  useUi.getState().setMode('tasks')
  const st = useTasks.getState()
  if (st.folder !== t.folder || st.fullAccess !== t.fullAccess || st.phase !== 'ready') {
    rememberFullAccess(t.folder, t.fullAccess)
    await connectFolder(t.folder, t.fullAccess)
  }
  if (useTasks.getState().phase !== 'ready') return
  await openTask(t.sessionId)
}
