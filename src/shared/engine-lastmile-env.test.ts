import { describe, expect, it } from 'vitest'
import {
  ENGINE_POLICY_FILE_NAME,
  ENV_ENGINE_POLICY_FILE,
  ENV_PERMISSION_SUGGESTION,
  ENV_WEB_SEARCH,
  enginePolicyEnvFor,
  enginePolicyPath,
  engineLastMileEnvFor,
  suggestionEnvFor,
  webSearchEnvFor
} from './engine-lastmile-env'

describe('búsqueda web con cualquier IA (OPENCODE_ENABLE_EXA)', () => {
  it('apagado, ausente o basura da {}', () => {
    expect(webSearchEnvFor({ webSearchAnyProvider: false })).toEqual({})
    expect(webSearchEnvFor({})).toEqual({})
    for (const v of ['true', 1, 'yes', null, {}]) expect(webSearchEnvFor({ webSearchAnyProvider: v as boolean }), String(v)).toEqual({})
  })
  it('encendido da EXACTAMENTE la variable', () => {
    expect(webSearchEnvFor({ webSearchAnyProvider: true })).toEqual({ OPENCODE_ENABLE_EXA: '1' })
    expect(ENV_WEB_SEARCH).toBe('OPENCODE_ENABLE_EXA')
  })
})

describe('sugerencia en las tarjetas de permiso (LAZUNOX_SUGERENCIA_PERMISOS)', () => {
  it('apagado, ausente o basura da {}', () => {
    expect(suggestionEnvFor({ permissionSuggestions: false })).toEqual({})
    expect(suggestionEnvFor({})).toEqual({})
    for (const v of ['true', 1, null]) expect(suggestionEnvFor({ permissionSuggestions: v as unknown as boolean }), String(v)).toEqual({})
  })
  it('encendido da EXACTAMENTE «1» (el motor no entiende «true»)', () => {
    expect(suggestionEnvFor({ permissionSuggestions: true })).toEqual({ LAZUNOX_SUGERENCIA_PERMISOS: '1' })
    expect(ENV_PERMISSION_SUGGESTION).toBe('LAZUNOX_SUGERENCIA_PERMISOS')
  })
})

describe('política de empresa del motor (LAZUNOX_POLICY_FILE, ruta de administrador)', () => {
  it('rutas de Mac y de Windows (junto a managed.json de Tareas)', () => {
    expect(enginePolicyPath('darwin')).toBe('/Library/Application Support/Lazunox/motor-policy.json')
    expect(enginePolicyPath('win32', { ProgramData: 'D:\\Datos' })).toBe('D:\\Datos\\Lazunox\\motor-policy.json')
    expect(enginePolicyPath('win32', {})).toBe('C:\\ProgramData\\Lazunox\\motor-policy.json')
    expect(ENGINE_POLICY_FILE_NAME).toBe('motor-policy.json')
  })
  it('ProgramData que no es una ruta absoluta de Windows se ignora (cae en C:\\ProgramData)', () => {
    for (const pd of ['', 'relativa', '..\\x', '/tmp/x', 'C:\\ok\0mal']) {
      expect(enginePolicyPath('win32', { ProgramData: pd }), JSON.stringify(pd)).toBe('C:\\ProgramData\\Lazunox\\motor-policy.json')
    }
  })
  it('solo si el archivo EXISTE; si no, {} (ausente = sin política)', () => {
    expect(enginePolicyEnvFor({ platform: 'darwin', exists: false })).toEqual({})
    expect(enginePolicyEnvFor({ platform: 'darwin', exists: true })).toEqual({
      [ENV_ENGINE_POLICY_FILE]: '/Library/Application Support/Lazunox/motor-policy.json'
    })
    expect(enginePolicyEnvFor({ platform: 'win32', exists: true, env: { ProgramData: 'C:\\ProgramData' } })).toEqual({
      LAZUNOX_POLICY_FILE: 'C:\\ProgramData\\Lazunox\\motor-policy.json'
    })
    expect(enginePolicyEnvFor({ platform: 'win32', exists: false })).toEqual({})
  })
  it('el override de desarrollo solo vale si es una ruta absoluta; si no, manda la ruta del administrador', () => {
    expect(enginePolicyEnvFor({ platform: 'darwin', exists: true, devOverride: '/tmp/p.json' })).toEqual({
      LAZUNOX_POLICY_FILE: '/tmp/p.json'
    })
    expect(enginePolicyEnvFor({ platform: 'win32', exists: true, devOverride: 'C:\\t\\p.json' })).toEqual({
      LAZUNOX_POLICY_FILE: 'C:\\t\\p.json'
    })
    for (const o of ['p.json', '../p.json', '', '/a\0b']) {
      expect(enginePolicyEnvFor({ platform: 'darwin', exists: true, devOverride: o })[ENV_ENGINE_POLICY_FILE], JSON.stringify(o)).toBe(
        '/Library/Application Support/Lazunox/motor-policy.json'
      )
    }
  })
  it('nunca sale de un ajuste: el resultado no depende de nada que escriba la persona', () => {
    const s = { webSearchAnyProvider: true, permissionSuggestions: true, policyFile: '/tmp/mia.json' } as never
    expect(engineLastMileEnvFor(s, { platform: 'darwin', exists: true })[ENV_ENGINE_POLICY_FILE]).toBe(
      '/Library/Application Support/Lazunox/motor-policy.json'
    )
  })
})

describe('engineLastMileEnvFor junta las tres', () => {
  it('todo apagado y sin archivo: {}', () => {
    expect(engineLastMileEnvFor({}, { platform: 'darwin', exists: false })).toEqual({})
    expect(engineLastMileEnvFor({})).toEqual({})
  })
  it('todo encendido: exactamente tres variables', () => {
    expect(engineLastMileEnvFor({ webSearchAnyProvider: true, permissionSuggestions: true }, { platform: 'darwin', exists: true })).toEqual(
      {
        OPENCODE_ENABLE_EXA: '1',
        LAZUNOX_SUGERENCIA_PERMISOS: '1',
        LAZUNOX_POLICY_FILE: '/Library/Application Support/Lazunox/motor-policy.json'
      }
    )
  })
  it('sin sonda del disco, solo las dos de los ajustes', () => {
    expect(engineLastMileEnvFor({ webSearchAnyProvider: true })).toEqual({ OPENCODE_ENABLE_EXA: '1' })
  })
})
