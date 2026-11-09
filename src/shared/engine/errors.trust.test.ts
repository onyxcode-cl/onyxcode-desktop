import { describe, expect, it } from 'vitest'
import { EngineError, FOLDER_NOT_TRUSTED, isFolderNotTrusted, toEngineError } from './errors'

describe('isFolderNotTrusted (motor lazunox.16, confianza obligatoria)', () => {
  it('reconoce el 403 del motor tal como lo devuelve el SDK ({ error: "folder_not_trusted" })', () => {
    expect(isFolderNotTrusted(toEngineError({ error: FOLDER_NOT_TRUSTED }, 403))).toBe(true)
  })
  it('reconoce el texto suelto y un objeto con el código', () => {
    expect(isFolderNotTrusted('HTTP 403 folder_not_trusted')).toBe(true)
    expect(isFolderNotTrusted({ error: FOLDER_NOT_TRUSTED })).toBe(true)
    expect(isFolderNotTrusted(new Error('folder_not_trusted'))).toBe(true)
  })
  it('un 403 de credenciales u otro error NO cuenta', () => {
    expect(isFolderNotTrusted(toEngineError({ message: 'bad credentials' }, 403))).toBe(false)
    expect(isFolderNotTrusted(toEngineError({ error: FOLDER_NOT_TRUSTED }, 500))).toBe(false)
    expect(isFolderNotTrusted(new EngineError('network', 'sin red'))).toBe(false)
    expect(isFolderNotTrusted(null)).toBe(false)
    expect(isFolderNotTrusted(undefined)).toBe(false)
  })
})
