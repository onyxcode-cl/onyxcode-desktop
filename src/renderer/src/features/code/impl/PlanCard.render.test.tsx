import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { PlanCardView } from './PlanCard'
import { derivePlan } from './plan-logic'

const todos = [
  { content: 'Revisar la carpeta', status: 'completed' },
  { content: 'Armar el Excel', status: 'in_progress' },
  { content: 'Revisar cifras', status: 'pending' }
] as never[]

describe('PlanCardView', () => {
  it('abierta: título, conteo, pasos y cronómetro del paso en curso', () => {
    const html = renderToStaticMarkup(<PlanCardView view={derivePlan(todos)!} open onToggle={() => undefined} elapsedMs={14_000} />)
    expect(html).toContain('Plan')
    expect(html).toContain('1 de 3 listos')
    expect(html).toContain('Armar el Excel')
    expect(html).toContain('0:14')
    expect(html).toContain('truncate')
    expect(html).toContain('data-state="done"')
    expect(html).toContain('data-state="pending"')
  })
  it('inactiva: explica lo pendiente sin mostrar trabajo ni tiempo', () => {
    const html = renderToStaticMarkup(
      <PlanCardView view={derivePlan(todos, false)!} open onToggle={() => undefined} elapsedMs={1_603_000} />
    )
    expect(html).toContain('El modelo no marcó estos pasos')
    expect(html.match(/sin confirmar/g)).toHaveLength(2)
    expect(html).not.toContain('trabajando')
    expect(html).not.toContain('26:43')
    expect(html).not.toContain('data-state="active"')
    expect(html).toContain('1 de 3 listos')
  })
  it('completo: no avisa de pasos sin confirmar', () => {
    const html = renderToStaticMarkup(
      <PlanCardView view={derivePlan([{ content: 'Listo', status: 'completed' }], false)!} open onToggle={() => undefined} elapsedMs={0} />
    )
    expect(html).not.toContain('sin confirmar')
    expect(html).not.toContain('El modelo no marcó')
  })
  it('plegada: solo el título', () => {
    const html = renderToStaticMarkup(<PlanCardView view={derivePlan(todos)!} open={false} onToggle={() => undefined} elapsedMs={0} />)
    expect(html).not.toContain('Armar el Excel')
    expect(html).toContain('aria-expanded="false"')
  })
})
