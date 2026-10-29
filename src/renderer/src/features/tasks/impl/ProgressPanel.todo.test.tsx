/** Un paso «en curso» no debe seguir girando cuando la tarea ya paró (visto en una tarea que terminó sin cerrar su último paso). */
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { TodoIcon } from './ProgressPanel'

describe('TodoIcon', () => {
  it('en curso con la tarea trabajando: gira', () => {
    expect(renderToStaticMarkup(<TodoIcon status="in_progress" live />)).toContain('animate-spin')
  })
  it('en curso con la tarea detenida: NO gira', () => {
    expect(renderToStaticMarkup(<TodoIcon status="in_progress" live={false} />)).not.toContain('animate-spin')
  })
  it('por defecto (sin `live`) sigue girando como siempre', () => {
    expect(renderToStaticMarkup(<TodoIcon status="in_progress" />)).toContain('animate-spin')
  })
  it('completado, cancelado y pendiente no giran nunca', () => {
    for (const status of ['completed', 'cancelled', 'pending']) {
      expect(renderToStaticMarkup(<TodoIcon status={status} live />)).not.toContain('animate-spin')
    }
  })
})
