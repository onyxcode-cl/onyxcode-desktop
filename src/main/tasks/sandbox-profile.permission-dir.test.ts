import { describe, expect, it } from 'vitest'
import { PERMISSION_DIR_NAME as COMPARTIDO } from '../../shared/permission-persist'
import { PERMISSION_DIR_NAME } from './sandbox-profile'

describe('PERMISSION_DIR_NAME de sandbox-profile', () => {
  it('coincide con el de @shared/permission-persist (se repite para que verify:bundled cargue el módulo sin alias)', () => {
    expect(PERMISSION_DIR_NAME).toBe(COMPARTIDO)
  })
})
