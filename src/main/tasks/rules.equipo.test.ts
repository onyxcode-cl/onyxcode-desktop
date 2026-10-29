/** `equipo_*` (comandos fuera del aislamiento) no se recuerda como «siempre»: cada comando se aprueba uno por uno. */
import { describe, expect, it } from 'vitest'
import { ruleRejectionReason } from './rules'
import { PERMISSION_NO_PERSIST } from '@shared/permission-persist'

describe('equipo_ejecutar nunca se recuerda', () => {
  it('el almacén de reglas lo rechaza', () => {
    expect(ruleRejectionReason('equipo_ejecutar', 'open *')).not.toBeNull()
    expect(ruleRejectionReason('equipo_detener', '*')).not.toBeNull()
  })
  it('el motor tampoco lo guarda (lista de «nunca guardar»)', () => {
    expect(PERMISSION_NO_PERSIST).toContain('equipo_*')
  })
})
