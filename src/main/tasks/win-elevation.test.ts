import { describe, expect, it } from 'vitest'
import { detectElevated, parseWhoamiGroups } from './win-elevation'

const line = (sid: string): string =>
  `"Etiqueta obligatoria\\Nivel obligatorio alto","Etiqueta","${sid}","Grupo obligatorio, Habilitado de manera predeterminada"\r\n`
const base =
  '"Todos","Grupo conocido","S-1-1-0","Grupo obligatorio, Habilitado"\r\n"BUILTIN\\Users","Alias","S-1-5-32-545","Grupo obligatorio"\r\n'

describe('parseWhoamiGroups', () => {
  it('Alta (12288) y Sistema (16384): elevado', () => {
    expect(parseWhoamiGroups(base + line('S-1-16-12288'))).toBe(true)
    expect(parseWhoamiGroups(base + line('S-1-16-16384'))).toBe(true)
  })
  it('Media (8192) y Baja (4096): no elevado', () => {
    expect(parseWhoamiGroups(base + line('S-1-16-8192'))).toBe(false)
    expect(parseWhoamiGroups(base + line('S-1-16-4096'))).toBe(false)
  })
  it('sin etiqueta, con varias, o con un nivel raro: no se sabe (null)', () => {
    expect(parseWhoamiGroups(base)).toBeNull()
    expect(parseWhoamiGroups('')).toBeNull()
    expect(parseWhoamiGroups(base + line('S-1-16-8192') + line('S-1-16-12288'))).toBeNull()
    expect(parseWhoamiGroups(base + line('S-1-16-0'))).toBeNull()
    expect(parseWhoamiGroups(base + line('S-1-16-5000'))).toBeNull()
  })
})

describe('detectElevated', () => {
  it('usa el ejecutor inyectado y nunca lanza', async () => {
    expect(await detectElevated(async () => base + line('S-1-16-12288'))).toBe(true)
    expect(await detectElevated(async () => base + line('S-1-16-8192'))).toBe(false)
    expect(
      await detectElevated(async () => {
        throw new Error('ENOENT')
      })
    ).toBeNull()
  })
})
