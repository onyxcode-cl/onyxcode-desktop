import { describe, expect, it } from 'vitest'
import { IPC_SCHEMAS, missingSchemas } from './schemas'

describe('contrato IPC', () => {
  it('todos los canales de invoke tienen esquema', () => {
    expect(missingSchemas()).toEqual([])
  })
})

describe('settings:set', () => {
  it('acepta checkUpdates booleano y rechaza otros tipos', () => {
    const v = IPC_SCHEMAS['settings:set']
    expect(v({ checkUpdates: false })).toEqual({ checkUpdates: false })
    expect(() => v({ checkUpdates: 'no' })).toThrow()
  })
})
