import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { RoutineInboxItem } from '@shared/ipc-tasks'

const override = vi.hoisted(() => ({ inbox: [] as unknown[] }))
vi.mock('./store', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./store')>()
  const useRoutines = Object.assign(
    (selector: (s: unknown) => unknown) => selector({ ...mod.useRoutines.getState(), inbox: override.inbox }),
    mod.useRoutines
  )
  return { ...mod, useRoutines }
})
vi.mock('./schedule', async (importOriginal) => ({ ...(await importOriginal<typeof import('./schedule')>()), fullDate: () => 'FECHA' }))

import { InboxCard, RoutineInbox } from './RoutineInbox'
import { selectInboxPending } from './store'

const result: RoutineInboxItem = {
  id: 'i1',
  kind: 'result',
  routineId: 'r1',
  routineName: 'Clasificar facturas',
  status: 'pending',
  createdAt: 1,
  runStatus: 'success',
  summary: 'Moví 3 facturas a /pagadas',
  files: ['pagadas/a.pdf'],
  triggerFiles: ['a.pdf'],
  rejectedCount: 1
}
const missed: RoutineInboxItem = {
  id: 'i2',
  kind: 'missed',
  routineId: 'r2',
  routineName: 'Informe semanal',
  status: 'pending',
  createdAt: 2,
  dueAt: 1,
  missedCount: 3
}

describe('bandeja «Resultados por revisar»', () => {
  it('un resultado muestra resumen, archivos y las cuatro acciones', () => {
    const html = renderToStaticMarkup(<InboxCard item={result} />)
    expect(html).toContain('Clasificar facturas')
    expect(html).toContain('Moví 3 facturas')
    for (const a of ['Aprobar', 'Descartar', 'Ver detalle', 'Volver a ejecutar']) expect(html).toContain(a)
  })
  it('un error se muestra como error', () => {
    const html = renderToStaticMarkup(<InboxCard item={{ ...result, runStatus: 'error', error: 'Falló el motor' }} />)
    expect(html).toContain('Falló el motor')
  })
  it('una ejecución perdida ofrece ejecutar u omitir (no aprobar)', () => {
    const html = renderToStaticMarkup(<InboxCard item={missed} />)
    expect(html).toContain('Ejecutar ahora')
    expect(html).toContain('Omitir')
    expect(html).not.toContain('Aprobar')
    expect(html).toContain('data-kind="missed"')
  })
  it('la bandeja lista solo lo pendiente con su contador; vacía no pinta nada', () => {
    override.inbox = [result, missed, { ...result, id: 'i3', status: 'approved' }]
    const html = renderToStaticMarkup(<RoutineInbox />)
    expect(html).toContain('Resultados por revisar')
    expect(html.match(/data-testid="inbox-item"/g)).toHaveLength(2)
    expect(selectInboxPending({ inbox: override.inbox as RoutineInboxItem[] })).toBe(2)
    override.inbox = []
    expect(renderToStaticMarkup(<RoutineInbox />)).toBe('')
  })
})
