import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { SidebarTree } from '../../../components/SidebarTreeRoot'
import { SessionRow } from './SessionList'

const row = (title: string, over: { waiting?: boolean; busy?: boolean }): string =>
  renderToStaticMarkup(
    createElement(
      SidebarTree,
      null,
      createElement(SessionRow, {
        session: { id: 's-' + title, title, time: { updated: Date.now() } },
        directory: '/tmp/proyecto',
        active: false,
        waiting: !!over.waiting,
        busy: !!over.busy,
        unread: false,
        needsReview: false,
        pinned: false
      })
    )
  )

describe('fila de sesión de Code en el árbol de escritorio (QA: el estado no se come el título)', () => {
  it('trabajando: solo el punto; el texto «Trabajando» queda en el title y en el nombre accesible', () => {
    const html = row('Preparar informe mensual de ventas', { busy: true })
    expect(html).toContain('data-state="working"')
    expect(html).not.toContain('>Trabajando</span>')
    expect(html).toMatch(/title="trabajando"/i)
    expect(html).toMatch(/aria-label="Preparar informe mensual de ventas · trabajando"/)
  })

  it('esperando aprobación: insignia de ícono de 20 px, sin la palabra «Aprobar» en la fila', () => {
    const html = row('Instalar dependencias del proyecto', { waiting: true })
    expect(html).toContain('data-state="waiting"')
    expect(html).toMatch(/data-testid="code-row-approve"[^>]*class="[^"]*size-5/)
    expect(html).not.toContain('>Aprobar</span>')
  })
})
