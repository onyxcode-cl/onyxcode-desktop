import { describe, expect, it } from 'vitest'
import { MODEL_FALLBACK_DEFAULTS, modelFallbackKey, normalizeModelFallback } from './model-fallback'
import { DEFAULT_SETTINGS } from './types'
import { engineNote } from './engine-notes'

describe('modelFallback: normalización', () => {
  it('por defecto: sin modelos y «otro proveedor» apagado', () => {
    expect(DEFAULT_SETTINGS.modelFallback).toEqual({ models: [], otherProvider: false })
    expect(normalizeModelFallback(undefined)).toEqual(MODEL_FALLBACK_DEFAULTS)
    expect(normalizeModelFallback('x')).toEqual(MODEL_FALLBACK_DEFAULTS)
    expect(normalizeModelFallback([1])).toEqual(MODEL_FALLBACK_DEFAULTS)
  })
  it('máximo 3 modelos, sin repetidos ni formas inválidas', () => {
    const r = normalizeModelFallback({
      models: ['a/m1', 'a/m1', 'sin-barra', '/x', 'a/', 'a/con espacio', 5, 'b/m2', 'c/m3', 'd/m4', 'o/x/y:free'],
      otherProvider: true
    })
    expect(r.models).toEqual(['a/m1', 'b/m2', 'c/m3'])
    expect(r.otherProvider).toBe(true)
    expect(normalizeModelFallback({ models: ['x/y/z'] }).models).toEqual(['x/y/z'])
  })
  it('«otro proveedor» solo con true exacto', () => {
    for (const v of ['true', 1, 'yes', null, undefined])
      expect(normalizeModelFallback({ models: ['a/b'], otherProvider: v }).otherProvider).toBe(false)
  })
})

describe('modelFallback: aviso en la conversación', () => {
  it('pinta metadata.lazunox_respaldo en llano (mismo servicio: solo el modelo)', () => {
    const txt = engineNote({
      type: 'text',
      metadata: { lazunox_respaldo: { de: 'opencode/big-free', a: 'opencode/small-free', motivo: 'cuota' } }
    })
    expect(txt).toBe('El modelo big-free no respondió; este turno se hizo con small-free.')
  })
  it('con otro servicio nombra el servicio; datos raros no rompen', () => {
    expect(engineNote({ type: 'text', metadata: { lazunox_respaldo: { de: 'a/x', a: 'b/y' } } })).toContain('a/x')
    expect(engineNote({ type: 'text', metadata: { lazunox_respaldo: { de: 'a/x', a: 'b/y' } } })).toContain('b/y')
    expect(engineNote({ type: 'text', metadata: { lazunox_respaldo: 'basura' } })).toBeNull()
    expect(engineNote({ type: 'text', metadata: { lazunox_respaldo: { de: 5, a: null } } })).toBeNull()
    expect(engineNote({ type: 'text', metadata: {} })).toBeNull()
  })
})

describe('modelFallback: huella', () => {
  it('cambia con la lista y con el consentimiento', () => {
    const a = modelFallbackKey({ models: ['a/b'], otherProvider: false })
    expect(modelFallbackKey({ models: ['a/b'], otherProvider: true })).not.toBe(a)
    expect(modelFallbackKey({ models: ['a/c'], otherProvider: false })).not.toBe(a)
    expect(modelFallbackKey(undefined)).toBe('sin-respaldo')
  })
})
