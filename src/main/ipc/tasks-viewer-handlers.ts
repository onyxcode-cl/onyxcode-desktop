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

export function registerTasksViewerHandlers(ctx: TasksIpcContext): TasksSubmodule {
  const { handle, tasks, send } = ctx
  const offViewer = onViewerEvent((event) => send('tasks:viewer:event', event))
  const offWeb = onWebEvent((event) => send('tasks:viewer:event', event))

  handle('tasks:viewer:open', async ({ path, lang, theme }) => {
    // Perezoso: crea la sesión/el esquema de Electron recién al primer uso real, no al registrar los
    // canales (al arrancar la app) — algunos arranques (p. ej. sin Control del PC) nunca lo necesitan.
    if (!tasksValidatorRegistered) {
      tasksValidatorRegistered = true
      registerViewerPathValidator((p) => tasks.assertInsideApproved(p))
    }
    installViewerScheme()
    const real = tasks.assertInsideApproved(path)
    const kind = sniffDocKind(real, readHeader(real))
    if (!kind) return { ok: false, reason: 'unsupported' }
    if (statSync(real).size > MAX_BYTES[kind]) return { ok: false, reason: 'too-large' }
    const token = issueToken({ path: real, kind })
    // Con el programa de ArtCraft instalado, el archivo se muestra en su versión WEB (misma pantalla y motor que el programa de escritorio).
    // La ruta ya se validó arriba (carpeta aprobada, tipo por bytes mágicos, tope de tamaño); si no está instalado o falla, el visor de siempre.
    if (
      await openInCraftWeb(
        kind,
        real,
        real
          .split(/[\\/]/)
          .pop()
          ?.replace(/\.[^.]+$/, '') ?? 'documento'
      )
    )
      return { ok: true, token, kind }
    openDoc(`${VIEWER_SCHEME}://viewer/index.html#t=${token}&kind=${kind}&lang=${lang}&theme=${theme}`)
    useClassicViewer()
    return { ok: true, token, kind }
  })

  handle('tasks:viewer:attach', ({ rect, visible }, event) => {
    const win = windowOfSender(event.sender) ?? ctx.getWindow()
    if (win) panelAttach(win, rect, visible)
  })

  handle('tasks:viewer:close', () => {
    revokeActive()
    panelClose()
  })

  return {
    dispose: () => {
      offViewer()
      offWeb()
      revokeActive()
      detach()
    }
  }
}
