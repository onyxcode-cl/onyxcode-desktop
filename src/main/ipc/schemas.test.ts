import { describe, expect, it } from 'vitest'
import { missingSchemas } from './schemas'

describe('contrato IPC', () => {
  it('todos los canales de invoke tienen esquema', () => {
    expect(missingSchemas()).toEqual([])
  })
})
