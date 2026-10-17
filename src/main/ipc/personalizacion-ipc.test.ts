import { describe, expect, it } from 'vitest'
import { IPC_EXTRAS_INVOKE_CHANNELS } from '@shared/ipc-extras'
import { CELULAR_POLICY } from '../remote/policy'
import { CHANNEL_ROLES, IPC_SCHEMAS } from './schemas'

const CHANNELS = [
  'personalizacion:skills:list',
  'personalizacion:skills:setEnabled',
  'personalizacion:skills:pick',
  'personalizacion:skills:install',
  'personalizacion:skills:remove'
] as const

describe('canales de Personalización (F8-B180)', () => {
  it('existen en el contrato, tienen esquema, son solo de la ventana principal y clase X para el celular', () => {
    for (const c of CHANNELS) {
      expect(IPC_EXTRAS_INVOKE_CHANNELS as readonly string[], c).toContain(c)
      expect(IPC_SCHEMAS[c], c).toBeTypeOf('function')
      for (const [role, set] of Object.entries(CHANNEL_ROLES)) expect(set.has(c), `${c} en ${role}`).toBe(false)
      expect((CELULAR_POLICY as Record<string, string>)[c], c).toBe('X')
    }
  })

  it('list y pick no admiten parámetros (el renderer nunca manda una ruta)', () => {
    for (const c of ['personalizacion:skills:list', 'personalizacion:skills:pick'] as const) {
      expect(() => IPC_SCHEMAS[c](undefined)).not.toThrow()
      expect(() => IPC_SCHEMAS[c]({ path: '/etc' })).toThrow()
      expect(() => IPC_SCHEMAS[c]({ folder: '/Users/x' })).toThrow()
    }
  })

  it('setEnabled: id de habilidad válido y booleano; nada de rutas ni claves extra', () => {
    const v = IPC_SCHEMAS['personalizacion:skills:setEnabled']
    expect(v({ id: 'docx', enabled: false })).toEqual({ id: 'docx', enabled: false })
    expect(v({ id: 'ruta-rapida', enabled: true })).toBeTruthy()
    for (const id of ['', 'Docx', '../docx', 'a/b', 'a b', '-a', 'a--b', 'x'.repeat(65)])
      expect(() => v({ id, enabled: true }), id).toThrow()
    expect(() => v({ id: 'docx', enabled: 'si' })).toThrow()
    expect(() => v({ id: 'docx' })).toThrow()
    expect(() => v({ id: 'docx', enabled: true, path: '/x' })).toThrow()
  })

  it('install: solo la ficha de 32 hex; remove: solo un nombre válido', () => {
    const inst = IPC_SCHEMAS['personalizacion:skills:install']
    expect(inst({ token: 'a'.repeat(32) })).toEqual({ token: 'a'.repeat(32) })
    for (const token of ['', 'a'.repeat(31), 'a'.repeat(33), 'G'.repeat(32), '../' + 'a'.repeat(29)])
      expect(() => inst({ token }), token).toThrow()
    expect(() => inst({ token: 'a'.repeat(32), folder: '/x' })).toThrow()
    const rm = IPC_SCHEMAS['personalizacion:skills:remove']
    expect(rm({ name: 'mi-habilidad' })).toEqual({ name: 'mi-habilidad' })
    for (const name of ['', '../x', 'A', 'a/b', 'x'.repeat(65)]) expect(() => rm({ name }), name).toThrow()
  })
})
