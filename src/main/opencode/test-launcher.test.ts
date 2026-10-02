import { describe, expect, it } from 'vitest'
import { testLauncher } from './test-launcher'

describe('testLauncher (solo pruebas)', () => {
  it('en win32 sin empaquetar convierte un .mjs en `node <mjs>`', () => {
    expect(testLauncher('C:\\t\\opencode.MJS', ['serve'], { isPackaged: false, platform: 'win32' })).toEqual({
      command: 'node',
      args: ['C:\\t\\opencode.MJS', 'serve']
    })
  })
  it('nunca empaquetado, ni fuera de win32, ni con un binario real', () => {
    expect(testLauncher('C:\\t\\x.mjs', ['serve'], { isPackaged: true, platform: 'win32' })).toEqual({
      command: 'C:\\t\\x.mjs',
      args: ['serve']
    })
    expect(testLauncher('/t/x.mjs', ['serve'], { isPackaged: false, platform: 'darwin' })).toEqual({ command: '/t/x.mjs', args: ['serve'] })
    expect(testLauncher('C:\\o\\opencode.exe', ['serve'], { isPackaged: false, platform: 'win32' })).toEqual({
      command: 'C:\\o\\opencode.exe',
      args: ['serve']
    })
  })
})
