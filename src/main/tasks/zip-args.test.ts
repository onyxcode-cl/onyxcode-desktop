import { describe, expect, it } from 'vitest'
import { winTarZipArgs } from './zip-args'

describe('winTarZipArgs (tar.exe)', () => {
  it('nombres distintos: un `-C carpeta nombre` por archivo (sin rutas dentro del zip, como `zip -j`)', () => {
    const { args } = winTarZipArgs('C:\\Users\\Ben\\Downloads\\x.zip', ['C:\\lzx\\a\\inf.docx', 'C:\\lzx\\a\\sub\\datos.csv'])
    expect(args).toEqual([
      '-a',
      '-c',
      '-f',
      'C:\\Users\\Ben\\Downloads\\x.zip',
      '-C',
      'C:\\lzx\\a',
      'inf.docx',
      '-C',
      'C:\\lzx\\a\\sub',
      'datos.csv'
    ])
  })
  it('nombres repetidos (también sin distinguir mayúsculas): rutas relativas al ancestro común', () => {
    const { args } = winTarZipArgs('C:\\t\\o.zip', ['C:\\lzx\\a\\Notas.txt', 'C:\\lzx\\b\\notas.TXT', 'C:\\lzx\\b\\otro.md'])
    expect(args).toEqual(['-a', '-c', '-f', 'C:\\t\\o.zip', '-C', 'C:\\lzx', 'a\\Notas.txt', 'b\\notas.TXT', 'b\\otro.md'])
  })
  it('un nombre que empieza por guion no se interpreta como opción de tar: se antepone `.\\`', () => {
    const { args } = winTarZipArgs('C:\\t\\o.zip', ['C:\\lzx\\--exclude=x', 'C:\\lzx\\ok.txt'])
    expect(args).toEqual(['-a', '-c', '-f', 'C:\\t\\o.zip', '-C', 'C:\\lzx', '.\\--exclude=x', '-C', 'C:\\lzx', 'ok.txt'])
    for (const a of args.slice(4)) expect(a.startsWith('-') && a !== '-C').toBe(false)
  })
})
