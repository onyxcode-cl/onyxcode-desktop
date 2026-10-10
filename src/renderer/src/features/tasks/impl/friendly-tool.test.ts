import { describe, expect, it } from 'vitest'
import type { ToolPart } from '@opencode-ai/sdk/v2/client'
import { friendlyTool } from './util'

const part = (tool: string, input: Record<string, unknown> = {}): ToolPart =>
  ({ id: 'p', type: 'tool', tool, state: { status: 'completed', input, output: '' } }) as unknown as ToolPart

describe('friendlyTool en lenguaje llano', () => {
  it('la aprobación del plan se dice como tal, no como «Control del Mac»', () => {
    expect(friendlyTool(part('computer_request_access'))).toEqual({ verb: 'Pidió tu aprobación', detail: 'del plan' })
  })
  it('las skills de documentos se nombran por su programa', () => {
    expect(friendlyTool(part('skill', { name: 'xlsx' }))).toEqual({ verb: 'Preparó', detail: 'Excel' })
    expect(friendlyTool(part('skill', { name: 'docx' })).detail).toBe('Word')
    expect(friendlyTool(part('skill', { name: 'ruta-rapida' })).detail).toBe('una herramienta')
  })
  it('un comando sin descripción se resume sin mostrar el comando', () => {
    const f = friendlyTool(part('bash', { command: 'python3 build_xlsx.py spec.json' }))
    expect(f).toEqual({ verb: 'Creó', detail: 'la hoja de Excel' })
  })
})
