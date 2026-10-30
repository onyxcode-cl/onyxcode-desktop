import { describe, expect, it } from 'vitest'
import { glassPlan, glassSupported, windowsBuild } from './window-glass'

describe('barra lateral de vidrio', () => {
  it('lee la compilación de Windows', () => {
    expect(windowsBuild('10.0.22621')).toBe(22621)
    expect(windowsBuild('rarísimo')).toBe(0)
  })

  it('solo hay vidrio en macOS y en Windows 11', () => {
    expect(glassSupported('darwin', '24.0.0')).toBe(true)
    expect(glassSupported('win32', '10.0.22621')).toBe(true)
    expect(glassSupported('win32', '10.0.19045')).toBe(false)
    expect(glassSupported('linux', '6.1.0')).toBe(false)
  })

  it('macOS usa vibrancy en suave y en vidrio; sólida lo apaga', () => {
    expect(glassPlan('glass', 'darwin', '24.0.0')).toEqual({ vibrancy: 'fullscreen-ui', material: 'none', transparent: true })
    expect(glassPlan('soft', 'darwin', '24.0.0').vibrancy).toBe('fullscreen-ui')
    expect(glassPlan('solid', 'darwin', '24.0.0')).toEqual({ vibrancy: null, material: 'none', transparent: false })
  })

  it('Windows 11: suave = Mica, vidrio = Acrylic', () => {
    expect(glassPlan('soft', 'win32', '10.0.22621').material).toBe('mica')
    expect(glassPlan('glass', 'win32', '10.0.22621').material).toBe('acrylic')
  })

  it('donde no se puede, queda sólida aunque se pida vidrio', () => {
    expect(glassPlan('glass', 'win32', '10.0.19045')).toEqual({ vibrancy: null, material: 'none', transparent: false })
    expect(glassPlan('glass', 'linux', '6.1.0').transparent).toBe(false)
  })
})
