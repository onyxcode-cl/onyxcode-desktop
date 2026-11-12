/**
 * Handlers del visor de documentos (`tasks:viewer:*`, Fase 0 del plan del visor). La ruta se
 * revalida con `tasks.assertInsideApproved` al abrir Y OTRA VEZ al servir los bytes (ver
 * `viewer/scheme.ts`): nunca confía en que la primera validación siga vigente. El tipo se detecta
 * por bytes mágicos (`doc-kind.ts`), nunca solo por la extensión.
 */
import { closeSync, openSync, readSync, statSync } from 'node:fs'
import { VIEWER_SCHEME } from '../security/app-protocol'
import { installViewerScheme, registerViewerPathValidator } from '../viewer/scheme'
import { detach, onViewerEvent, openDoc } from '../viewer/view'
import { onWebEvent } from '../office/craft/web-view'
import { openInCraftWeb, panelAttach, panelClose, useClassicViewer } from '../office/craft/web-open'
import { issueToken, revokeActive } from '../viewer/tokens'
import { MAX_BYTES, sniffDocKind } from '../viewer/doc-kind'
import { recordProblem } from '../diagnostics/problem-log'
import { windowOfSender } from './sender-window'
import type { TasksIpcContext, TasksSubmodule } from './tasks-handle'

const HEADER_BYTES = 8

function readHeader(path: string): Uint8Array {
  const head = Buffer.alloc(HEADER_BYTES)
  const fd = openSync(path, 'r')
  try {
    readSync(fd, head, 0, HEADER_BYTES, 0)
  } finally {
    closeSync(fd)
  }
  return head
}

let tasksValidatorRegistered = false
/** Número de la última apertura: un cierre (o otra apertura) mientras la vista web de ArtCraft aún cargaba invalida la anterior. */
let openGeneration = 0
let activeOpeningId: string | null = null

/** Solo el nombre dentro de la carpeta: nunca unidad, usuario, padre ni texto de un error de fs. */
export function viewerLogPath(path: string): string {
  return `…/${(path.split(/[\\/]/).pop() || 'documento').replace(/[\r\n\t\u0000-\u001f]/g, '_')}`
}

export function registerTasksViewerHandlers(ctx: TasksIpcContext): TasksSubmodule {
  const { handle, tasks, send } = ctx
  let logPath = ''
  let phase = 'inicio'
  let viewport = 'sin hueco'
  let pendingTimer: ReturnType<typeof setTimeout> | undefined
  const log = (reason: string, problem = false): void => {
    const message = `[tasks-viewer] ${reason}; etapa=${phase}; ruta=${logPath}; plataforma=${process.platform}; hueco=${viewport}`
    if (problem) {
      console.warn(message)
      recordProblem({ source: 'document', message })
    } else console.info(message)
  }
  const forward = (event: { type: 'loaded' | 'error' | 'crashed' | 'escape' }): void => {
    if (!activeOpeningId) return
    if (event.type === 'error' || event.type === 'crashed') log(event.type, true)
    send('tasks:viewer:event', { ...event, openingId: activeOpeningId })
  }
  const offViewer = onViewerEvent(forward)
  const offWeb = onWebEvent(forward)

  handle('tasks:viewer:open', async ({ path, lang, theme, openingId }) => {
    clearTimeout(pendingTimer)
    const generation = ++openGeneration
    activeOpeningId = openingId
    logPath = viewerLogPath(path)
    phase = 'validación'
    log('abrir')
    // Segundo reloj en main: deja diagnóstico y libera recursos aunque el renderer no logre cerrar.
    const watchdog = setTimeout(() => {
      if (generation !== openGeneration) return
      log('sin respuesta a los 8 s', true)
      send('tasks:viewer:event', { type: 'error', openingId })
      activeOpeningId = null
      openGeneration++
      revokeActive()
      panelClose()
    }, 8_000)
    pendingTimer = watchdog
    try {
      // Perezoso: crea la sesión/el esquema de Electron recién al primer uso real, no al registrar los
      // canales (al arrancar la app) — algunos arranques (p. ej. sin Control del PC) nunca lo necesitan.
      if (!tasksValidatorRegistered) {
        tasksValidatorRegistered = true
        registerViewerPathValidator((p) => tasks.assertInsideApproved(p))
      }
      installViewerScheme()
      phase = 'ruta'
      const real = tasks.assertInsideApproved(path)
      phase = 'cabecera'
      const kind = sniffDocKind(real, readHeader(real))
      if (!kind) return { ok: false, reason: 'unsupported' }
      if (statSync(real).size > MAX_BYTES[kind]) return { ok: false, reason: 'too-large' }
      const token = issueToken({ path: real, kind })
      phase = 'web'
      // Con el programa de ArtCraft instalado, el archivo se muestra en su versión WEB (misma pantalla y motor que el programa de escritorio).
      // La ruta ya se validó arriba (carpeta aprobada, tipo por bytes mágicos, tope de tamaño); si no está instalado o falla, el visor de siempre.
      const openedInCraft = await openInCraftWeb(
        kind,
        real,
        real
          .split(/[\\/]/)
          .pop()
          ?.replace(/\.[^.]+$/, '') ?? 'documento'
      )
      // La persona salió de la vista (o abrió otro archivo) mientras cargaba: no se deja nada abierto ni se abre el visor de respaldo
      // con un token ya revocado (quedaba pegado a la derecha mostrando «No se pudo mostrar el documento»).
      if (generation !== openGeneration) {
        return { ok: false, reason: 'unsupported' }
      }
      if (openedInCraft) {
        phase = 'listo'
        log('web recibió el archivo')
        return { ok: true, token, kind, mode: 'web' }
      }
      phase = 'respaldo-cargando'
      const loaded = openDoc(`${VIEWER_SCHEME}://viewer/index.html#t=${token}&kind=${kind}&lang=${lang}&theme=${theme}`)
      useClassicViewer()
      if (!(await loaded)) {
        if (generation === openGeneration) log('carga del respaldo fallida', true)
        return { ok: false, reason: 'load-failed' }
      }
      if (generation !== openGeneration) return { ok: false, reason: 'load-failed' }
      phase = 'respaldo'
      log('respaldo cargado')
      return { ok: true, token, kind, mode: 'classic' }
    } catch {
      if (generation === openGeneration) log('apertura fallida', true)
      return { ok: false, reason: 'load-failed' }
    } finally {
      clearTimeout(watchdog)
      if (pendingTimer === watchdog) pendingTimer = undefined
    }
  })

  handle('tasks:viewer:attach', ({ rect, visible }, event) => {
    const win = windowOfSender(event.sender) ?? ctx.getWindow()
    viewport = `${rect.width}x${rect.height}, visible=${visible}, ventana=${!!win}`
    if (win) panelAttach(win, rect, visible)
    return !!win && rect.width > 0 && rect.height > 0
  })

  handle('tasks:viewer:close', ({ openingId, reason }) => {
    if (openingId !== activeOpeningId) return
    clearTimeout(pendingTimer)
    if (reason) log(reason === 'timeout' ? 'sin respuesta a los 8 s' : 'error mostrado en el panel', true)
    activeOpeningId = null
    openGeneration++
    revokeActive()
    panelClose()
  })

  return {
    dispose: () => {
      offViewer()
      offWeb()
      clearTimeout(pendingTimer)
      activeOpeningId = null
      openGeneration++
      revokeActive()
      panelClose()
      detach()
    }
  }
}
