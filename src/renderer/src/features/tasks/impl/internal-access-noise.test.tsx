import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { ToolPart } from '@opencode-ai/sdk/v2/client'
import { isInternalAccessNoise } from '../../../lib/plan-gate'
import { ActivityRow } from './ProgressPanel'
import { buildContext, groupActivityBySteps, isInternalNoiseStep } from './util'
import type { MessageEntry } from '../../../stores/sessions'

// Texto exacto que devuelve src/main/computer/mcp-server.ts cuando el agente llama computer_request_access sin apps.
const ISOLATED = 'Indica en "apps" las apps que vas a controlar (con su nivel en "levels"). En este modo no hace falta plan.'
const NORMAL =
  'Indica al menos una app en "apps" o, si la tarea no controla ninguna app (solo terminal, archivos o web), un "plan" con "apps": [].'

const part = (error: string): ToolPart =>
  ({
    id: 'p1',
    type: 'tool',
    tool: 'computer_request_access',
    state: { status: 'error', error, input: {}, time: { start: 1, end: 2 } }
  }) as unknown as ToolPart

describe('texto interno de computer_request_access (tareas de documentos)', () => {
  it('se reconoce', () => {
    expect(isInternalAccessNoise(ISOLATED)).toBe(true)
    expect(isInternalAccessNoise(NORMAL)).toBe(true)
    expect(isInternalAccessNoise('EPERM: operation not permitted')).toBe(false)
  })
  it('la lista de pasos no lo muestra ni lo pinta como error', () => {
    for (const e of [ISOLATED, NORMAL]) {
      const html = renderToStaticMarkup(<ActivityRow part={part(e)} />)
      expect(html).not.toContain('no hace falta plan')
      expect(html).not.toContain('Indica ')
      expect(html).not.toContain('text-danger')
    }
  })
  it('un error real sí se sigue mostrando', () => {
    expect(renderToStaticMarkup(<ActivityRow part={part('Fallo real del disco')} />)).toContain('Fallo real del disco')
  })

  it('variantes del texto: comillas escapadas o tipográficas, o solo la frase final', () => {
    expect(isInternalAccessNoise('Error: Indica en \\"apps\\" las apps que vas a controlar (con su nivel en \\"levels\\").')).toBe(true)
    expect(isInternalAccessNoise('Indica en “apps” las apps que vas a controlar')).toBe(true)
    expect(isInternalAccessNoise('MCP error: En este modo no hace falta plan.')).toBe(true)
  })

  const entry = (parts: ToolPart[]): MessageEntry => ({ info: { id: 'm1', role: 'assistant' }, parts }) as unknown as MessageEntry

  it('el paso no entra en la lista agrupada del panel («Historial de la tarea») ni en el Contexto', () => {
    const e = [entry([part(ISOLATED)])]
    expect(isInternalNoiseStep(part(ISOLATED))).toBe(true)
    expect(groupActivityBySteps(e)).toEqual([])
    expect(buildContext(e).connectors).toEqual([])
  })

  it('un computer_request_access con otro error sí se conserva', () => {
    const e = [entry([part('Fallo real')])]
    expect(groupActivityBySteps(e)).toHaveLength(1)
  })
})
