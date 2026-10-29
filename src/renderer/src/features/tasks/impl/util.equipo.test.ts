/** La tarjeta de permiso no ofrece «siempre» para los comandos del equipo (`equipo_*`). */
import { describe, expect, it } from 'vitest'
import { isRememberablePermission } from './util'

describe('equipo_* no se ofrece como regla', () => {
  it.each(['equipo_ejecutar', 'equipo_detener'])('%s', (permission) => {
    expect(isRememberablePermission(permission, 'open x')).toBe(false)
  })
})
