import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Session } from '@opencode-ai/sdk/v2/client'
import { stripDesk } from '../../../../../test/strip-desk'

// NO se importa el store real de Tareas (suscribe a useSessions al cargar): se sustituye por un
// stub mínimo, igual que TaskConversation.render.test.tsx. `isPinned` y `syncActivity` son los
// únicos símbolos del store que arrastran TaskList/SidebarSections a nivel de módulo.
vi.mock('./store', () => ({
  useTasks: Object.assign(() => undefined, { getState: () => ({}), setState: () => undefined, subscribe: () => () => undefined }),
  isPinned: () => false,
  syncActivity: () => undefined
}))

import { TaskRow } from './TaskList'
import { SectionRow, StatusIcon } from './SidebarSections'
import type { TaskStatus } from './util'

const STATUSES: TaskStatus[] = [
  'running',
  'using_computer',
  'plan_ready',
  'waiting',
  'question',
  'done',
  'error',
  'idle',
  'archived',
  'interrupted'
]

function session(id: string, title: string, updated: number, archived?: number): Session {
  return { id, title, time: { created: 0, updated, archived } } as unknown as Session
}

const NOW = Date.now()

describe('sidebar de Tareas (render estático, sin desk:)', () => {
  it('StatusIcon en los 10 estados', () => {
    expect(stripDesk(STATUSES.map((s) => renderToStaticMarkup(<StatusIcon status={s} />)).join('\n'))).toMatchInlineSnapshot(`
      "<span role="img" aria-label="Trabajando" class="inline-flex"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-loader-circle lucide-loader-2 animate-spin text-accent" aria-hidden="true"><path d="M21 12a9 9 0 1 1-6.219-8.56"></path></svg></span>
      <span role="img" aria-label="Usando el Mac" class="inline-flex"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-mouse-pointer-2 animate-pulse text-accent" aria-hidden="true"><path d="M4.037 4.688a.495.495 0 0 1 .651-.651l16 6.5a.5.5 0 0 1-.063.947l-6.124 1.58a2 2 0 0 0-1.438 1.435l-1.579 6.126a.5.5 0 0 1-.947.063z"></path></svg></span>
      <span role="img" aria-label="Plan listo para revisar" class="inline-flex"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-clipboard-check text-warning" aria-hidden="true"><rect width="8" height="4" x="8" y="2" rx="1" ry="1"></rect><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"></path><path d="m9 14 2 2 4-4"></path></svg></span>
      <span role="img" aria-label="Esperando tu aprobación" class="inline-flex"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-hand text-warning" aria-hidden="true"><path d="M18 11V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2"></path><path d="M14 10V4a2 2 0 0 0-2-2a2 2 0 0 0-2 2v2"></path><path d="M10 10.5V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2v8"></path><path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15"></path></svg></span>
      <span role="img" aria-label="Esperando tu respuesta" class="inline-flex"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-circle-question-mark lucide-help-circle lucide-circle-help text-accent" aria-hidden="true"><circle cx="12" cy="12" r="10"></circle><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"></path><path d="M12 17h.01"></path></svg></span>
      <span role="img" aria-label="Terminado" class="inline-flex"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-circle-check lucide-check-circle-2 text-accent" aria-hidden="true"><circle cx="12" cy="12" r="10"></circle><path d="m16 9-5.5 5.5L8 12"></path></svg></span>
      <span role="img" aria-label="Error" class="inline-flex"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-circle-alert lucide-alert-circle text-danger" aria-hidden="true"><circle cx="12" cy="12" r="10"></circle><line x1="12" x2="12" y1="8" y2="12"></line><line x1="12" x2="12.01" y1="16" y2="16"></line></svg></span>
      <span role="img" aria-label="Nueva" class="inline-flex"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-circle text-subtle" aria-hidden="true"><circle cx="12" cy="12" r="10"></circle></svg></span>
      <span role="img" aria-label="Archivada" class="inline-flex"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-archive text-subtle" aria-hidden="true"><rect width="20" height="5" x="2" y="3" rx="1"></rect><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8"></path><path d="M10 12h4"></path></svg></span>
      <span role="img" aria-label="Interrumpida" class="inline-flex"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-rotate-ccw text-warning" aria-hidden="true"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"></path><path d="M3 3v5h5"></path></svg></span>"
    `)
  })

  it('TaskRow terminada, activa', () => {
    const html = renderToStaticMarkup(
      <TaskRow
        task={session('t1', 'Resumir contrato', NOW)}
        status="done"
        active
        unseen={false}
        blockedHost={false}
        archivedView={false}
        group={null}
        knownGroups={[]}
      />
    )
    expect(stripDesk(html)).toMatchInlineSnapshot(`"<div class="group flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm bg-active"><span class="shrink-0"><span role="img" aria-label="Terminado" class="inline-flex"><svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-circle-check lucide-check-circle-2 text-accent" aria-hidden="true"><circle cx="12" cy="12" r="10"></circle><path d="m16 9-5.5 5.5L8 12"></path></svg></span></span><button type="button" class="min-w-0 flex-1 text-left" aria-current="true"><div class="truncate ">Resumir contrato</div><div data-quiet="true" class="truncate text-[11px] text-subtle">ahora</div></button><span class="hidden shrink-0 text-[11px] text-subtle tabular-nums ">ahora</span><div class="relative shrink-0"><button type="button" title="Más acciones" aria-label="Más acciones de la tarea «Resumir contrato»" aria-haspopup="menu" aria-expanded="false" class="rounded p-0.5 text-subtle group-focus-within:opacity-100 group-hover:opacity-100 hover:text-fg focus-visible:opacity-100 opacity-0"><svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-ellipsis lucide-more-horizontal" aria-hidden="true"><circle cx="12" cy="12" r="1"></circle><circle cx="19" cy="12" r="1"></circle><circle cx="5" cy="12" r="1"></circle></svg></button></div></div>"`)
  })

  it('TaskRow terminada, inactiva', () => {
    const html = renderToStaticMarkup(
      <TaskRow
        task={session('t2', 'Ordenar informes', NOW)}
        status="done"
        active={false}
        unseen={false}
        blockedHost={false}
        archivedView={false}
        group={null}
        knownGroups={[]}
      />
    )
    expect(stripDesk(html)).toMatchInlineSnapshot(`"<div class="group flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-hover"><span class="shrink-0"><span role="img" aria-label="Terminado" class="inline-flex"><svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-circle-check lucide-check-circle-2 text-accent" aria-hidden="true"><circle cx="12" cy="12" r="10"></circle><path d="m16 9-5.5 5.5L8 12"></path></svg></span></span><button type="button" class="min-w-0 flex-1 text-left"><div class="truncate ">Ordenar informes</div><div data-quiet="true" class="truncate text-[11px] text-subtle">ahora</div></button><span class="hidden shrink-0 text-[11px] text-subtle tabular-nums ">ahora</span><div class="relative shrink-0"><button type="button" title="Más acciones" aria-label="Más acciones de la tarea «Ordenar informes»" aria-haspopup="menu" aria-expanded="false" class="rounded p-0.5 text-subtle group-focus-within:opacity-100 group-hover:opacity-100 hover:text-fg focus-visible:opacity-100 opacity-0"><svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-ellipsis lucide-more-horizontal" aria-hidden="true"><circle cx="12" cy="12" r="1"></circle><circle cx="19" cy="12" r="1"></circle><circle cx="5" cy="12" r="1"></circle></svg></button></div></div>"`)
  })

  it('SectionRow con subtítulo', () => {
    const html = renderToStaticMarkup(
      <SectionRow
        icon={<StatusIcon status="running" size={13} />}
        title="Tarea activa"
        subtitle="Informes · Trabajando"
        active={false}
        fullAccess={false}
        hint="/ruta/informes"
        onClick={() => undefined}
      />
    )
    expect(stripDesk(html)).toMatchInlineSnapshot(`"<button type="button" title="/ruta/informes" class="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-hover"><span class="shrink-0"><span role="img" aria-label="Trabajando" class="inline-flex"><svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-loader-circle lucide-loader-2 animate-spin text-accent" aria-hidden="true"><path d="M21 12a9 9 0 1 1-6.219-8.56"></path></svg></span></span><span class="min-w-0 flex-1"><span class="block truncate">Tarea activa</span><span class="block truncate text-[11px] text-subtle">Informes · Trabajando</span></span></button>"`)
  })
})
