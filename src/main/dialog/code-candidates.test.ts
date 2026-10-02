import { describe, expect, it } from 'vitest'
import { codeCandidates } from './code-candidates'

describe('codeCandidates', () => {
  it('Windows: Code.exe por usuario y del sistema, nunca code.cmd', () => {
    const r = codeCandidates('win32', {
      LOCALAPPDATA: 'C:\\Users\\x\\AppData\\Local',
      ProgramFiles: 'C:\\Program Files',
      'ProgramFiles(x86)': 'C:\\Program Files (x86)'
    })
    expect(r).toEqual([
      'C:\\Users\\x\\AppData\\Local\\Programs\\Microsoft VS Code\\Code.exe',
      'C:\\Program Files\\Microsoft VS Code\\Code.exe',
      'C:\\Program Files (x86)\\Microsoft VS Code\\Code.exe'
    ])
    expect(r.some((c) => /code\.cmd$/i.test(c) || c === 'code')).toBe(false)
  })
  it('Windows: variables con otra capitalización y entorno vacío', () => {
    expect(codeCandidates('win32', { localappdata: 'D:\\L' })).toEqual(['D:\\L\\Programs\\Microsoft VS Code\\Code.exe'])
    expect(codeCandidates('win32', {})).toEqual([])
  })
  it('macOS: el comando code y rutas conocidas', () => {
    expect(codeCandidates('darwin', {})[0]).toBe('code')
  })
})
