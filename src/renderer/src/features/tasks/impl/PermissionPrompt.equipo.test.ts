/** El motor pide permiso de una herramienta MCP con `metadata: {}` y `patterns: ['*']`: el comando se lee de la propia llamada (tool.callID). */
import type { PermissionRequest } from '@opencode-ai/sdk/v2/client'
import { describe, expect, it } from 'vitest'
import type { MessageEntry } from '../../../lib/session-reducer'
import { describePermission, toolInputOf } from './PermissionPrompt'

const req = (over: Partial<PermissionRequest> = {}): PermissionRequest => ({
  id: 'per_1',
  sessionID: 'ses_1',
  permission: 'equipo_ejecutar',
  patterns: ['*'],
  metadata: {},
  always: ['*'],
  tool: { messageID: 'msg_1', callID: 'call_1' },
  ...over
})

const entries = (input: unknown, callID = 'call_1'): MessageEntry[] =>
  [
    {
      info: { id: 'msg_1' },
      parts: [
        { type: 'text', text: 'hola' },
        { type: 'tool', callID, tool: 'equipo_ejecutar', state: { status: 'running', input } }
      ]
    }
  ] as never

describe('toolInputOf', () => {
  it('encuentra los argumentos por callID', () => {
    expect(toolInputOf(req(), entries({ comando: 'open "/x/a.pdf"', motivo: 'abrir el PDF' }))).toEqual({
      comando: 'open "/x/a.pdf"',
      motivo: 'abrir el PDF'
    })
  })
  it('sin callID, sin conversación, con otro callID o con entrada que no es objeto → null', () => {
    expect(toolInputOf(req({ tool: undefined }), entries({ a: 1 }))).toBeNull()
    expect(toolInputOf(req(), undefined)).toBeNull()
    expect(toolInputOf(req(), entries({ a: 1 }, 'otra'))).toBeNull()
    expect(toolInputOf(req(), entries('texto'))).toBeNull()
    expect(toolInputOf(req(), entries([1, 2]))).toBeNull()
  })
})

describe('tarjeta de equipo_ejecutar', () => {
  it('muestra el comando COMPLETO y el motivo, y es peligrosa (nunca «siempre»)', () => {
    const d = describePermission(req(), [], (x) => x, {
      comando: 'mkdir "/Users/ben/Desktop/prueba final"',
      motivo: 'Crear la carpeta que pediste.'
    })
    expect(d.detail).toBe('mkdir "/Users/ben/Desktop/prueba final"')
    expect(d.aiDescription).toBe('Crear la carpeta que pediste.')
    expect(d.title).toContain('comando')
    expect(d.danger).toBe(true)
  })
  it('sin argumentos disponibles cae a los patrones (nunca queda vacía)', () => {
    expect(describePermission(req(), [], (x) => x, null).detail).toBe('*')
  })
  it('una herramienta MCP cualquiera (de un conector) también muestra sus argumentos', () => {
    const d = describePermission(req({ permission: 'crm_buscar', tool: { messageID: 'm', callID: 'c' } }), ['crm'], (x) => x, {
      texto: 'Acme'
    })
    expect(d.detail).toContain('"texto": "Acme"')
  })
})
