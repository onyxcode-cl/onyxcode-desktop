/**
 * Handlers del visor de documentos (`tasks:viewer:*`, Fase 0 del plan del visor). La ruta se
 * revalida con `tasks.assertInsideApproved` al abrir Y OTRA VEZ al servir los bytes (ver
 * `viewer/scheme.ts`): nunca confía en que la primera validación siga vigente. El tipo se detecta
 * por bytes mágicos (`doc-kind.ts`), nunca solo por la extensión.
 */
import { closeSync, openSync, readSync, statSync } from 'node:fs'
import { VIEWER_SCHEME } from '../security/app-protocol'
import { installViewerScheme, registerViewerPathValidator } from '../viewer/scheme'
import { attach, closeView, detach, onViewerEvent, openDoc } from '../viewer/view'
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
  const off = onViewerEvent((event) => send('tasks:viewer:event', event))

  handle('tasks:viewer:open', ({ path, lang, theme }) => {
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
    openDoc(`${VIEWER_SCHEME}://viewer/index.html#t=${token}&kind=${kind}&lang=${lang}&theme=${theme}`)
    return { ok: true, token, kind }
  })

  handle('tasks:viewer:attach', ({ rect, visible }, event) => {
    const win = windowOfSender(event.sender) ?? ctx.getWindow()
    if (win) attach(win, rect, visible)
  })

  handle('tasks:viewer:close', () => {
    revokeActive()
    closeView()
  })

  return {
    dispose: () => {
      off()
      revokeActive()
      detach()
    }
  }
}
