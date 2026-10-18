import { describe, expect, it } from 'vitest'
import { IPC_EXTRAS_INVOKE_CHANNELS } from '@shared/ipc-extras'
import { PROJECT_LIMITS } from '@shared/project-knowledge'
import { CELULAR_POLICY } from '../remote/policy'
import { CHANNEL_ROLES, IPC_SCHEMAS } from './schemas'

const CHANNELS = [
  'projects:list',
  'projects:create',
  'projects:update',
  'projects:delete',
  'projects:pickFiles',
  'projects:addPicked',
  'projects:addBytes',
  'projects:removeFile',
  'projects:assign',
  'projects:context'
] as const

const ID = 'a1b2c3d4e5f60718'
const TOKEN = 'f'.repeat(32)

describe('canales de Proyectos (F8-B185)', () => {
  it('existen en el contrato, tienen esquema, son solo de la ventana principal y clase X para el celular', () => {
    for (const c of CHANNELS) {
      expect(IPC_EXTRAS_INVOKE_CHANNELS as readonly string[], c).toContain(c)
      expect(IPC_SCHEMAS[c], c).toBeTypeOf('function')
      for (const [role, set] of Object.entries(CHANNEL_ROLES)) expect(set.has(c), `${c} en ${role}`).toBe(false)
      expect((CELULAR_POLICY as Record<string, string>)[c], c).toBe('X')
    }
  })

  it('list no admite parámetros; pickFiles solo el id (el renderer nunca manda una ruta)', () => {
    expect(() => IPC_SCHEMAS['projects:list'](undefined)).not.toThrow()
    expect(() => IPC_SCHEMAS['projects:list']({ path: '/etc' })).toThrow()
    const pick = IPC_SCHEMAS['projects:pickFiles']
    expect(pick({ id: ID })).toEqual({ id: ID })
    expect(() => pick({ id: ID, path: '/Users/x' })).toThrow()
    expect(() => pick({ id: ID, paths: ['/Users/x'] })).toThrow()
  })

  it('ids de proyecto: solo 16 hex (nada de rutas ni mayúsculas)', () => {
    const del = IPC_SCHEMAS['projects:delete']
    expect(del({ id: ID })).toEqual({ id: ID })
    for (const id of ['', '../../etc/passwd', ID.toUpperCase(), 'a'.repeat(15), 'a'.repeat(17), `${ID}/..`, 'g'.repeat(16)])
      expect(() => del({ id }), id).toThrow()
    expect(() => del({})).toThrow()
    expect(() => del({ id: ID, extra: 1 })).toThrow()
  })

  it('create: nombre obligatorio con tope; instrucciones opcionales con tope; sin claves extra', () => {
    const v = IPC_SCHEMAS['projects:create']
    expect(v({ name: 'Contratos' })).toEqual({ name: 'Contratos' })
    expect(v({ name: 'A', instructions: 'x'.repeat(PROJECT_LIMITS.maxInstructionsChars) })).toBeTruthy()
    expect(() => v({ name: '' })).toThrow()
    expect(() => v({ name: 'x'.repeat(PROJECT_LIMITS.maxNameChars + 1) })).toThrow()
    expect(() => v({ name: 'A', instructions: 'x'.repeat(PROJECT_LIMITS.maxInstructionsChars + 1) })).toThrow()
    expect(() => v({ name: 'A', folder: '/x' })).toThrow()
    expect(() => v({ name: 3 })).toThrow()
  })

  it('update: id y al menos los campos permitidos', () => {
    const v = IPC_SCHEMAS['projects:update']
    expect(v({ id: ID, name: 'Nuevo' })).toEqual({ id: ID, name: 'Nuevo' })
    expect(v({ id: ID, instructions: '' })).toEqual({ id: ID, instructions: '' })
    expect(() => v({ id: ID, name: '' })).toThrow()
    expect(() => v({ id: ID, files: [] })).toThrow()
  })

  it('addPicked: solo la ficha de 32 hex', () => {
    const v = IPC_SCHEMAS['projects:addPicked']
    expect(v({ id: ID, token: TOKEN })).toEqual({ id: ID, token: TOKEN })
    for (const token of ['', 'f'.repeat(31), 'f'.repeat(33), 'G'.repeat(32), '../' + 'f'.repeat(29), '/etc/passwd'])
      expect(() => v({ id: ID, token }), token).toThrow()
    expect(() => v({ id: ID, token: TOKEN, path: '/x' })).toThrow()
  })

  it('addBytes: nombre y base64 con tope (~10 MB); nada más', () => {
    const v = IPC_SCHEMAS['projects:addBytes']
    expect(v({ id: ID, name: 'a.pdf', base64: 'AAAA' })).toBeTruthy()
    expect(() => v({ id: ID, name: '', base64: 'AAAA' })).toThrow()
    expect(() => v({ id: ID, name: 'a'.repeat(301), base64: 'AAAA' })).toThrow()
    expect(() => v({ id: ID, name: 'a.pdf', base64: 'A'.repeat(Math.ceil((PROJECT_LIMITS.maxFileBytes * 4) / 3) + 17) })).toThrow()
    expect(() => v({ id: ID, name: 'a.pdf', base64: 'AAAA', path: '/x' })).toThrow()
  })

  it('removeFile y assign', () => {
    expect(IPC_SCHEMAS['projects:removeFile']({ id: ID, fileId: ID })).toEqual({ id: ID, fileId: ID })
    expect(() => IPC_SCHEMAS['projects:removeFile']({ id: ID, fileId: '../x' })).toThrow()
    const a = IPC_SCHEMAS['projects:assign']
    expect(a({ sessionId: 'ses_abc123', projectId: ID })).toEqual({ sessionId: 'ses_abc123', projectId: ID })
    expect(a({ sessionId: 'ses_abc123', projectId: null })).toEqual({ sessionId: 'ses_abc123', projectId: null })
    expect(() => a({ sessionId: '../x', projectId: ID })).toThrow()
    expect(() => a({ sessionId: 'ses_abc123', projectId: 'otro' })).toThrow()
    expect(() => a({ sessionId: 'ses_abc123' })).toThrow()
  })

  it('context: sesión válida, pregunta con tope y mensaje anterior opcional', () => {
    const v = IPC_SCHEMAS['projects:context']
    expect(v({ sessionId: 'ses_1', query: '¿cuánto es?' })).toBeTruthy()
    expect(v({ sessionId: 'ses_1', query: 'x', recent: 'antes' })).toBeTruthy()
    expect(() => v({ sessionId: 'ses_1', query: 'x'.repeat(20_001) })).toThrow()
    expect(() => v({ sessionId: 'ses_1', query: 'x', recent: 'x'.repeat(4001) })).toThrow()
    expect(() => v({ sessionId: 'a b', query: 'x' })).toThrow()
    expect(() => v({ sessionId: 'ses_1', query: 'x', projectId: ID })).toThrow() // el proyecto lo decide main, no el renderer
  })
})
