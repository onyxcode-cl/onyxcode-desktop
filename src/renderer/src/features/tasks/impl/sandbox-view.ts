/**
 * Qué muestra la interfaz de Tareas según el estado del entorno aislado (`tasks:sandbox:status`). PURO y probado: solo se pintan
 * las acciones que de verdad hacen algo (`actions`), y `blocksStart` dice si hay que impedir que se envíen tareas (en Windows,
 * mientras el entorno no esté listo; en macOS nunca). El texto sale de claves `tasks.sandbox.*`, nunca del detalle técnico.
 */
import type { MsgKey } from '@shared/i18n'
import type { TasksSandboxStatus } from '@shared/ipc-tasks'

export type SandboxViewKind =
  | 'hidden'
  | 'checking'
  | 'needsSetup'
  | 'needsUpdate'
  | 'installing'
  | 'setupError'
  | 'needsWsl'
  | 'needsWsl2'
  | 'needsVirtualization'
  | 'policy'
  | 'unavailable'
  | 'broken'

export type SandboxAction = 'setup' | 'cancel' | 'recheck'

export interface SandboxView {
  kind: SandboxViewKind
  title: MsgKey | null
  body: MsgKey | null
  /** Etiqueta del botón de `setup` (instalar, actualizar, reparar o reintentar). */
  setupLabel?: MsgKey
  actions: SandboxAction[]
  /** Solo `installing`: 0–100 y la fase traducible. */
  pct?: number
  phase?: MsgKey
  /** Solo `setupError`: motivo ya traducible. */
  error?: MsgKey
  /** Detalle técnico (solo `broken` genérico). */
  detail?: string
  /** ¿Hay que impedir que se envíen tareas ahora? */
  blocksStart: boolean
}

const HIDDEN: SandboxView = { kind: 'hidden', title: null, body: null, actions: [], blocksStart: false }

const PHASES: Record<string, MsgKey> = {
  start: 'tasks.sandbox.phase.start',
  downloading: 'tasks.sandbox.phase.downloading',
  verifying: 'tasks.sandbox.phase.verifying',
  creating: 'tasks.sandbox.phase.creating',
  installing: 'tasks.sandbox.phase.installing',
  checking: 'tasks.sandbox.phase.checking',
  done: 'tasks.sandbox.phase.done'
}

export const SETUP_ERRORS: Record<string, MsgKey> = {
  offline: 'tasks.sandbox.error.offline',
  'no-space': 'tasks.sandbox.error.no-space',
  'bad-hash': 'tasks.sandbox.error.bad-hash',
  'bad-payload': 'tasks.sandbox.error.bad-hash',
  'bad-bundle': 'tasks.sandbox.error.bad-bundle',
  'download-failed': 'tasks.sandbox.error.download-failed',
  blocked: 'tasks.sandbox.error.blocked',
  busy: 'tasks.sandbox.error.busy',
  foreign: 'tasks.sandbox.error.foreign'
}

function brokenBody(detail: string | undefined): MsgKey {
  if (detail === 'payload') return 'tasks.sandbox.broken.payload'
  if (detail?.startsWith('landlock')) return 'tasks.sandbox.broken.landlock'
  if (detail === 'interop') return 'tasks.sandbox.broken.interop'
  if (detail === 'drives') return 'tasks.sandbox.broken.drives'
  if (detail === 'foreign') return 'tasks.sandbox.broken.foreign'
  if (detail === 'wsl1') return 'tasks.sandbox.broken.wsl1'
  return 'tasks.sandbox.broken.generic'
}

/**
 * @param status último estado recibido, o `null` si aún no llegó.
 * @param backend `platformCaps().tasksSandbox`: solo `wsl` (Windows) pinta algo; en macOS el aislamiento es del sistema.
 */
export function sandboxView(status: TasksSandboxStatus | null, backend: 'seatbelt' | 'wsl' | 'none'): SandboxView {
  if (backend !== 'wsl') return HIDDEN
  if (!status) return { kind: 'checking', title: null, body: 'tasks.sandbox.checking', actions: [], blocksStart: true }
  const s = status.setup
  if (s?.running) {
    return {
      kind: 'installing',
      title: 'tasks.sandbox.installing.title',
      body: 'tasks.sandbox.installing.hint',
      actions: ['cancel'],
      pct: Math.max(0, Math.min(100, Math.round(s.pct))),
      phase: PHASES[s.phase] ?? PHASES.installing,
      blocksStart: true
    }
  }
  const canRetry = status.state === 'needsSetup' || (status.state === 'broken' && status.detail === 'payload')
  if (s?.error && canRetry) {
    return {
      kind: 'setupError',
      title: 'tasks.sandbox.error.title',
      body: null,
      error: SETUP_ERRORS[s.error] ?? 'tasks.sandbox.error.generic',
      setupLabel: 'tasks.sandbox.retry',
      actions: ['setup', 'recheck'],
      blocksStart: true
    }
  }
  switch (status.state) {
    case 'ready':
      return HIDDEN
    case 'needsSetup': {
      const update = status.detail?.startsWith('update:') === true
      return {
        kind: update ? 'needsUpdate' : 'needsSetup',
        title: update ? 'tasks.sandbox.needsUpdate.title' : 'tasks.sandbox.needsSetup.title',
        body: update ? 'tasks.sandbox.needsUpdate.body' : 'tasks.sandbox.needsSetup.body',
        setupLabel: update ? 'tasks.sandbox.needsUpdate.action' : 'tasks.sandbox.needsSetup.action',
        actions: ['setup'],
        blocksStart: true
      }
    }
    case 'needsWsl':
      return {
        kind: 'needsWsl',
        title: 'tasks.sandbox.needsWsl.title',
        body: status.detail === 'org' ? 'tasks.sandbox.needsWsl.org' : 'tasks.sandbox.needsWsl.body',
        actions: ['recheck'],
        blocksStart: true
      }
    case 'needsWsl2':
      return {
        kind: 'needsWsl2',
        title: 'tasks.sandbox.needsWsl2.title',
        body: 'tasks.sandbox.needsWsl2.body',
        actions: ['recheck'],
        blocksStart: true
      }
    case 'needsVirtualization':
      return {
        kind: 'needsVirtualization',
        title: 'tasks.sandbox.needsVirtualization.title',
        body: 'tasks.sandbox.needsVirtualization.body',
        actions: ['recheck'],
        blocksStart: true
      }
    case 'policyDisabled':
      return { kind: 'policy', title: 'tasks.sandbox.policy.title', body: 'tasks.sandbox.policy.body', actions: [], blocksStart: true }
    case 'broken': {
      const repair = status.detail === 'payload'
      return {
        kind: 'broken',
        title: 'tasks.sandbox.broken.title',
        body: brokenBody(status.detail),
        ...(repair ? { setupLabel: 'tasks.sandbox.broken.repair' as MsgKey } : {}),
        actions: repair ? ['setup', 'recheck'] : ['recheck'],
        ...(brokenBody(status.detail) === 'tasks.sandbox.broken.generic' && status.detail ? { detail: status.detail } : {}),
        blocksStart: true
      }
    }
    default:
      // `unsupported` (puertas de seguridad cerradas) y cualquier estado que no conozcamos: cierra, sin acciones que no hacen nada.
      return {
        kind: 'unavailable',
        title: 'tasks.sandbox.unavailable.title',
        body: 'tasks.sandbox.unavailable.body',
        actions: [],
        blocksStart: true
      }
  }
}
