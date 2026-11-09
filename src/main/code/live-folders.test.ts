import { describe, expect, it } from 'vitest'
import { getLiveFolders, setLiveFolders } from './live-folders'

describe('carpetas abiertas con confianza (live-folders)', () => {
  it('empieza vacía (falla cerrado) y reemplaza la lista', () => {
    setLiveFolders([])
    expect(getLiveFolders()).toEqual([])
    setLiveFolders(['/a', '/b'])
    expect(getLiveFolders()).toEqual(['/a', '/b'])
    setLiveFolders(['/c'])
    expect(getLiveFolders()).toEqual(['/c'])
  })

  it('descarta lo que no es una ruta absoluta de texto, duplicados y pasa de 24', () => {
    expect(setLiveFolders(['rel/ativa', 5, '', '/a', '/a', 'C:\\w', '\\\\srv\\x'])).toEqual(['/a', 'C:\\w', '\\\\srv\\x'])
    expect(setLiveFolders(Array.from({ length: 40 }, (_, i) => `/d${i}`))).toHaveLength(24)
    expect(setLiveFolders('no-es-lista')).toEqual([])
  })
})
