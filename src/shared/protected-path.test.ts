import { describe, expect, it } from 'vitest'
import { isProtectedPermission } from './protected-path'

describe('isProtectedPermission', () => {
  it('solo el booleano true exacto marca una ruta protegida', () => {
    expect(isProtectedPermission({ lazunoxProtegido: true })).toBe(true)
    expect(isProtectedPermission({ lazunoxProtegido: true, command: 'x' })).toBe(true)
    for (const bad of [
      undefined,
      null,
      {},
      [],
      'true',
      1,
      true,
      { lazunoxProtegido: 'true' },
      { lazunoxProtegido: 1 },
      { lazunoxProtegido: false }
    ])
      expect(isProtectedPermission(bad), JSON.stringify(bad)).toBe(false)
  })
})
