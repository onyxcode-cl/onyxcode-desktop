/**
 * Fijación del celular/PWA ANTES de tocar el código de las demás tarjetas de Tareas: FolderRequestCard,
 * NetworkBlocked, QuestionCard, EscalateCard y DeleteGrantHintCard en `remote` se congelan con literales
 * inline (nunca `vitest -u`). En escritorio solo se AÑADEN clases `desk:` (que `stripDesk` elimina), así
 * que este marcado no cambia.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ReactNode } from 'react'
import type { PermissionRequest } from '@opencode-ai/sdk/v2/client'
import { stripDesk } from '../../../../../test/strip-desk'
import { assistantMessage, textPart, toolPart } from '../../../../../test/fixtures/events'
import type { MessageEntry } from '../../../stores/sessions'

const mock = vi.hoisted(() => ({ state: {} as Record<string, unknown> }))
// La tarjeta y sus dependencias (actions.ts) importan muchas acciones del store real; como no se
// importa el store real (suscribe a useSessions al cargar), se sustituye por noops + un `useTasks`
// que evalúa el selector contra `mock.state`.
vi.mock('./store', () => {
  const noop = () => undefined
  return {
    useTasks: Object.assign((sel?: (s: unknown) => unknown) => (sel ? sel(mock.state) : mock.state), {
      getState: () => mock.state,
      setState: () => undefined,
      subscribe: () => () => undefined
    }),
    rootTaskId: (id: string) => id,
    currentTasksModel: () => null,
    currentTasksVariant: () => null,
    dismissNetworkBlocked: noop,
    resolveNetworkBlocked: noop,
    clearFolder: noop,
    clearUnseen: noop,
    connectFolder: noop,
    disconnect: noop,
    forgetTaskMeta: noop,
    fullAccessFor: () => false,
    loadFullAccessInfo: noop,
    loadGrants: noop,
    loadProjectAndMemory: noop,
    loadTask: noop,
    refreshComputerStatus: noop,
    rememberFolder: noop,
    rememberFullAccess: noop,
    setTaskMeta: noop
  }
})
vi.mock('../../../lib/notify', () => ({ sendNotification: vi.fn(), setAttentionCount: vi.fn() }))

import { FolderRequestCard } from './FolderRequestCard'
import { NetworkBlockedCards } from './NetworkBlocked'
import { QuestionCard } from './QuestionPrompt'
import { EscalateCard } from './EscalateCard'
import { DeleteGrantHintCard } from './DeleteGrant'

const g = globalThis as unknown as { window?: { api?: { platform?: string } } }
function surface(platform: string | null): void {
  if (platform === null) delete g.window
  else g.window = { api: { platform } }
}
afterEach(() => surface(null))

const html = (el: ReactNode): string => stripDesk(renderToStaticMarkup(el))

const folderReq = {
  id: 'per_1',
  sessionID: 's',
  permission: 'external_directory',
  patterns: ['/Users/ana/proyectos/demo/*'],
  metadata: { parentDir: '/Users/ana/proyectos/demo' },
  always: []
} as PermissionRequest

const mcpQuestion = {
  id: 'q_1',
  sessionID: 's',
  questions: [
    {
      header: 'Nombre',
      question: '¿Cómo se llama?',
      options: [
        { label: 'Alfa', description: '' },
        { label: 'Beta', description: '' }
      ],
      multiple: false,
      custom: true
    }
  ]
}

const escalateEntries: MessageEntry[] = [
  { info: assistantMessage('m1', 's'), parts: [textPart('p1', 'm1', 's', '**Necesita Control total del Mac**: para instalar la app')] }
]

const blockedDeleteEntries: MessageEntry[] = [
  {
    info: assistantMessage('m2', 's'),
    parts: [toolPart('p2', 'm2', 's', 'bash', { status: 'error', error: 'rm: Operation not permitted' })]
  }
]

describe('celular/PWA: demás tarjetas de Tareas (sin cambios)', () => {
  it('FolderRequestCard (otra carpeta)', () => {
    surface('remote')
    mock.state = { conn: null, policy: {} }
    expect(html(<FolderRequestCard request={folderReq} />)).toMatchInlineSnapshot(
      `"<div id="perm-per_1" tabindex="-1" class="rounded-xl border border-warning/40 bg-warning/5 p-3.5 outline-none"><div class="flex items-start gap-3"><span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-warning/15 text-warning"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-folder-input" aria-hidden="true"><path d="M2 9V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H20a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-1"></path><path d="M2 13h10"></path><path d="m9 16 3-3-3-3"></path></svg></span><div class="min-w-0 flex-1"><p class="text-sm font-semibold">El agente quiere trabajar en otra carpeta</p><p class="mt-0.5 text-xs text-muted">Esta ubicación queda fuera de la carpeta de la tarea. Al permitirla se reiniciará el espacio de trabajo de las tareas y la tarea continuará sola.</p><p class="mt-2.5 text-[11px] font-medium text-subtle">Carpeta que pide el agente</p><pre class="mt-1 max-h-24 overflow-auto rounded-md border border-border bg-code px-2.5 py-1.5 font-mono text-xs whitespace-pre-wrap">/Users/ana/proyectos/demo</pre><div class="mt-2.5 rounded-md border border-border/70 bg-hover/40 px-2.5 py-1.5"><p class="text-[11px] font-medium text-subtle">Motivo (según el agente, no verificado)</p><p class="mt-0.5 text-xs text-muted">El agente no indicó un motivo.</p></div><fieldset class="mt-3 min-w-0"><legend class="text-[11px] font-medium text-subtle">Carpeta a la que darás acceso</legend><div role="radiogroup" class="mt-1 space-y-1"><label class="flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-xs hover:bg-hover has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent"><input type="radio" class="accent-[var(--accent)]" name="_R_0_-path" checked=""/><span class="min-w-0 flex-1 truncate font-mono" title="/Users/ana/proyectos/demo">/Users/ana/proyectos/demo</span><span class="shrink-0 text-[11px] text-subtle">la que pide</span></label><label class="flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-xs hover:bg-hover has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent"><input type="radio" class="accent-[var(--accent)]" name="_R_0_-path"/><span class="min-w-0 flex-1 truncate font-mono" title="/Users/ana/proyectos">/Users/ana/proyectos</span></label></div></fieldset><fieldset class="mt-3 min-w-0"><legend class="text-[11px] font-medium text-subtle">Modo de acceso</legend><div role="radiogroup" class="mt-1 flex flex-wrap gap-1.5"><label title="Podrá leer los archivos, no cambiarlos." class="flex cursor-pointer items-center gap-2 rounded-lg border px-2.5 py-1 text-xs has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent border-accent/50 bg-accent-soft text-accent"><input type="radio" class="sr-only" name="_R_0_-mode" checked=""/>Solo lectura</label><label title="Podrá leer, crear y modificar archivos." class="flex cursor-pointer items-center gap-2 rounded-lg border px-2.5 py-1 text-xs has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent border-border text-muted hover:bg-hover"><input type="radio" class="sr-only" name="_R_0_-mode"/>Lectura y escritura</label></div><p class="mt-1 text-[11px] text-subtle">Podrá leer los archivos, no cambiarlos.</p></fieldset><label class="mt-3 flex cursor-pointer items-start gap-2 text-xs"><input type="checkbox" class="mt-0.5 accent-[var(--accent)]"/><span>No volver a preguntar (carpeta de confianza)</span></label><div class="mt-3 flex flex-wrap items-center gap-2"><button type="button" class="no-drag inline-flex items-center justify-center rounded-lg font-medium transition-[background-color,border-color,color,filter,transform] duration-150 select-none active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50 px-3 py-1.5 text-sm gap-2 text-muted hover:bg-hover hover:text-fg ">Denegar</button><button type="button" class="no-drag inline-flex items-center justify-center rounded-lg font-medium transition-[background-color,border-color,color,filter,transform] duration-150 select-none active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50 px-3 py-1.5 text-sm gap-2 bg-elevated text-fg border border-border shadow-xs hover:bg-hover hover:border-border-strong ">Ahora no</button><button type="button" class="no-drag inline-flex items-center justify-center rounded-lg font-medium transition-[background-color,border-color,color,filter,transform] duration-150 select-none active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50 px-3 py-1.5 text-sm gap-2 bg-accent text-accent-fg shadow-xs hover:bg-accent-hover "> Permitir</button></div></div></div></div>"`
    )
  })

  it('NetworkBlockedCards (pendiente)', () => {
    surface('remote')
    mock.state = { networkBlocked: { t1: [{ host: 'api.ejemplo.com', port: 443, at: 1000 }] } }
    expect(html(<NetworkBlockedCards taskId="t1" />)).toMatchInlineSnapshot(
      `"<div class="flex flex-col gap-2"><div class="rounded-xl border border-amber-500/40 bg-amber-500/5 p-3.5"><div class="flex items-start gap-3"><span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-amber-500/15 text-amber-700 [[data-theme=dark]_&amp;]:text-amber-400"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-shield-off" aria-hidden="true"><path d="m2 2 20 20"></path><path d="M5 5a1 1 0 0 0-1 1v7c0 5 3.5 7.5 7.67 8.94a1 1 0 0 0 .67.01c2.35-.82 4.48-1.97 5.9-3.71"></path><path d="M9.309 3.652A12.252 12.252 0 0 0 11.24 2.28a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1v7a9.784 9.784 0 0 1-.08 1.264"></path></svg></span><div class="min-w-0 flex-1"><p class="text-sm font-semibold">Se bloqueó el acceso a api.ejemplo.com</p><p class="mt-0.5 text-xs text-muted">El agente intentó conectarse a esta dirección desde la carpeta sandboxeada y no está en la lista blanca de red.</p><div class="mt-3 flex flex-wrap items-center gap-2"><button type="button" class="no-drag inline-flex items-center justify-center rounded-lg font-medium transition-[background-color,border-color,color,filter,transform] duration-150 select-none active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50 px-3 py-1.5 text-sm gap-2 bg-accent text-accent-fg shadow-xs hover:bg-accent-hover "> Permitir esta vez</button><button type="button" class="no-drag inline-flex items-center justify-center rounded-lg font-medium transition-[background-color,border-color,color,filter,transform] duration-150 select-none active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50 px-3 py-1.5 text-sm gap-2 bg-elevated text-fg border border-border shadow-xs hover:bg-hover hover:border-border-strong "> Permitir siempre</button><button type="button" class="no-drag inline-flex items-center justify-center rounded-lg font-medium transition-[background-color,border-color,color,filter,transform] duration-150 select-none active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50 px-3 py-1.5 text-sm gap-2 text-muted hover:bg-hover hover:text-fg "> Mantener bloqueado</button></div></div></div></div></div>"`
    )
  })

  it('QuestionCard', () => {
    surface('remote')
    expect(html(<QuestionCard request={mcpQuestion} />)).toMatchInlineSnapshot(
      `"<div id="question-q_1"><div data-m="pending-card" class="my-2 rounded-xl border border-accent/40 bg-elevated px-3.5 py-3 shadow-sm "><div class="mb-3"><div class="flex items-start gap-2 text-sm"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-circle-question-mark lucide-help-circle lucide-circle-help mt-0.5 shrink-0 text-accent" aria-hidden="true"><circle cx="12" cy="12" r="10"></circle><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"></path><path d="M12 17h.01"></path></svg><div><div class="text-xs font-medium tracking-wide text-muted uppercase">Nombre</div><div class="font-medium">¿Cómo se llama?</div></div></div><div class="mt-2 ml-6 flex flex-wrap gap-2" role="radiogroup"><button type="button" role="radio" aria-checked="false" class="rounded-lg border px-2.5 py-1 text-left text-sm transition min-h-11 px-4 border-border hover:bg-hover"><span class="block">Alfa</span></button><button type="button" role="radio" aria-checked="false" class="rounded-lg border px-2.5 py-1 text-left text-sm transition min-h-11 px-4 border-border hover:bg-hover"><span class="block">Beta</span></button></div><input placeholder="Otra respuesta…" class="mt-2 ml-6 w-[calc(100%-1.5rem)] rounded-lg border border-border bg-bg px-2.5 py-1 text-sm outline-none focus:border-accent min-h-11" value=""/></div><div class="flex gap-2"><button type="button" class="no-drag inline-flex items-center justify-center rounded-lg font-medium transition-[background-color,border-color,color,filter,transform] duration-150 select-none active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50 px-3 py-1.5 text-sm gap-2 bg-accent text-accent-fg shadow-xs hover:bg-accent-hover min-h-11 flex-1" disabled="">Responder</button><button type="button" class="no-drag inline-flex items-center justify-center rounded-lg font-medium transition-[background-color,border-color,color,filter,transform] duration-150 select-none active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50 px-3 py-1.5 text-sm gap-2 text-muted hover:bg-hover hover:text-fg min-h-11 flex-1">Omitir</button></div></div></div>"`
    )
  })

  it('EscalateCard', () => {
    surface('remote')
    mock.state = {}
    expect(html(<EscalateCard taskId="t1" entries={escalateEntries} />)).toMatchInlineSnapshot(
      `"<div class="rounded-xl border border-warning/40 bg-warning/5 p-3.5"><div class="flex items-start gap-3"><span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-warning/15 text-warning"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-shield-alert" aria-hidden="true"><path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"></path><path d="M12 8v4"></path><path d="M12 16h.01"></path></svg></span><div class="min-w-0 flex-1"><p class="text-sm font-semibold">Esta tarea necesita controlar apps de tu Mac</p><p class="mt-0.5 break-words text-sm text-fg">para instalar la app</p><p class="mt-0.5 text-xs text-muted">El modo sandbox no puede abrir apps, hacer clic, teclear en otras apps ni capturar la pantalla. Si cambias a Control total, se abrirá una tarea nueva con tu encargo y un resumen de lo hecho hasta ahora; antes te pediremos confirmar el cambio y el agente pedirá tu aprobación para actuar.</p><div class="mt-3 flex flex-wrap items-center gap-2"><button type="button" class="no-drag inline-flex items-center justify-center rounded-lg font-medium transition-[background-color,border-color,color,filter,transform] duration-150 select-none active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50 px-3 py-1.5 text-sm gap-2 bg-accent text-accent-fg shadow-xs hover:bg-accent-hover ">Cambiar a Control total y continuar</button><button type="button" class="no-drag inline-flex items-center justify-center rounded-lg font-medium transition-[background-color,border-color,color,filter,transform] duration-150 select-none active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50 px-3 py-1.5 text-sm gap-2 text-muted hover:bg-hover hover:text-fg ">Seguir en sandbox</button></div></div></div></div>"`
    )
  })

  it('DeleteGrantHintCard', () => {
    surface('remote')
    mock.state = { deleteGrant: null, deleteGrantBusy: false }
    expect(html(<DeleteGrantHintCard entries={blockedDeleteEntries} />)).toMatchInlineSnapshot(
      `"<div class="rounded-xl border border-warning/40 bg-warning/5 p-3.5"><div class="flex items-start gap-3"><span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-warning/15 text-warning"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-trash lucide-trash-2" aria-hidden="true"><path d="M10 11v6"></path><path d="M14 11v6"></path><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"></path><path d="M3 6h18"></path><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg></span><div class="min-w-0 flex-1"><p class="text-sm font-semibold">El agente intentó borrar, mover o renombrar un archivo y no pudo</p><p class="mt-0.5 text-xs text-muted">Por seguridad, esta carpeta no permite borrar, mover ni renombrar archivos todavía. Si lo activas, el servidor de la tarea se reiniciará y tendrás que reabrir esta tarea y pedirle al agente que continúe. Si prefieres no hacerlo, pídele una copia ordenada sin tocar los originales.</p><div class="mt-3 flex flex-wrap items-center gap-2"><button type="button" class="no-drag inline-flex items-center justify-center rounded-lg font-medium transition-[background-color,border-color,color,filter,transform] duration-150 select-none active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50 px-3 py-1.5 text-sm gap-2 bg-accent text-accent-fg shadow-xs hover:bg-accent-hover "> Permitir borrar, mover y renombrar</button><button type="button" class="no-drag inline-flex items-center justify-center rounded-lg font-medium transition-[background-color,border-color,color,filter,transform] duration-150 select-none active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50 px-3 py-1.5 text-sm gap-2 text-muted hover:bg-hover hover:text-fg ">Ahora no</button></div></div></div></div>"`
    )
  })
})
