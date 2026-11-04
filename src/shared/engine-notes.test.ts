import { describe, expect, it } from 'vitest'
import { engineNote, isBackgroundShell, liveShellCount } from './engine-notes'

const bash = (meta: Record<string, unknown>, tool = 'bash') => ({ type: 'tool', tool, state: { status: 'completed', metadata: meta } })

describe('comandos en segundo plano', () => {
  it('running + shellId = sigue en segundo plano', () => {
    expect(isBackgroundShell(bash({ running: true, shellId: 'sh_1' }))).toBe(true)
  })
  it('sin shellId, ya terminado o de otra herramienta: no', () => {
    expect(isBackgroundShell(bash({ running: true }))).toBe(false)
    expect(isBackgroundShell(bash({ running: false, shellId: 'sh_1' }))).toBe(false)
    expect(isBackgroundShell(bash({ running: true, shellId: 'sh_1' }, 'read'))).toBe(false)
    expect(isBackgroundShell({ tool: 'bash', state: { status: 'completed' } })).toBe(false)
  })
  it('cuenta cada comando una vez y la última lectura manda', () => {
    const msgs = [
      { parts: [bash({ running: true, shellId: 'a' }), bash({ running: true, shellId: 'b' })] },
      { parts: [bash({ running: true, shellId: 'a' }, 'shell_wait'), bash({ running: false, shellId: 'b' }, 'shell_wait')] }
    ]
    expect(liveShellCount(msgs)).toBe(1)
    expect(liveShellCount(undefined)).toBe(0)
    expect(liveShellCount([{ parts: [{ type: 'text', text: 'hola' }] }])).toBe(0)
  })
})

describe('avisos de reintento y cambio de modelo', () => {
  it('reintento: dice intento, causa y espera, sin jerga', () => {
    const txt = engineNote({
      type: 'text',
      metadata: { lazunox_reintento: JSON.stringify({ attempt: 2, max: 5, cause: 'sobrecarga', waitMs: 8000, message: 'overloaded' }) }
    })
    expect(txt).toBe('Reintento 2 de 5: el servicio está saturado. Esperando 8 s.')
  })
  it('reintento con causa desconocida usa un texto general', () => {
    const txt = engineNote({ type: 'text', metadata: { lazunox_reintento: JSON.stringify({ attempt: 1, max: 3, cause: 'x', waitMs: 0 }) } })
    expect(txt).toBe('Reintento 1 de 3: el modelo no respondió.')
  })
  it('reintento dañado: no se pinta nada', () => {
    expect(engineNote({ type: 'text', metadata: { lazunox_reintento: '{roto' } })).toBeNull()
    expect(engineNote({ type: 'text', metadata: { lazunox_reintento: JSON.stringify({ x: 1 }) } })).toBeNull()
  })
  it('cambio de modelo no aplicado', () => {
    const txt = engineNote({
      type: 'text',
      metadata: {
        lazunox_cambio_modelo: {
          anterior: { providerID: 'p', modelID: 'viejo' },
          nuevo: { providerID: 'p', modelID: 'nuevo' },
          motivo: 'compactacion-fallida'
        }
      }
    })
    expect(txt).toBe('No se cambió a «nuevo»: no se pudo resumir la conversación para que le cupiera. Se sigue con «viejo».')
  })
  it('partes normales y metadatos raros: null', () => {
    expect(engineNote({ type: 'text' })).toBeNull()
    expect(engineNote({ type: 'text', metadata: { lazunox_cambio_modelo: 'basura' } })).toBeNull()
    expect(engineNote({ type: 'tool', metadata: { lazunox_reintento: '{}' } })).toBeNull()
  })
})
