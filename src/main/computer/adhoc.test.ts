import { describe, expect, it } from 'vitest'
import { bundleOf, isAdhocOutput, isAdhocSigned } from './adhoc'

describe('firma ad-hoc', () => {
  it('encuentra el .app del ejecutable', () => {
    expect(bundleOf('/Applications/Lazunox.app/Contents/MacOS/Lazunox')).toBe('/Applications/Lazunox.app')
    expect(bundleOf('/x/node_modules/electron/dist/electron')).toBeNull()
  })
  it('reconoce la salida de codesign', () => {
    expect(isAdhocOutput('Identifier=a\nSignature=adhoc\nTeamIdentifier=not set')).toBe(true)
    expect(isAdhocOutput('CodeDirectory v=20400 flags=0x2(adhoc) hashes=1')).toBe(true)
    expect(isAdhocOutput('Authority=Developer ID Application: X\nTeamIdentifier=ABCDE12345')).toBe(false)
    expect(isAdhocOutput('')).toBe(false)
  })
  it('ad-hoc → true; certificado, error o fuera de un .app → false', async () => {
    const app = '/A/Lazunox.app/Contents/MacOS/Lazunox'
    expect(await isAdhocSigned(app, async () => 'Signature=adhoc')).toBe(true)
    expect(await isAdhocSigned(app, async () => 'Authority=Developer ID')).toBe(false)
    expect(await isAdhocSigned(app, async () => Promise.reject(new Error('x')))).toBe(false)
    expect(await isAdhocSigned('/x/electron', async () => 'Signature=adhoc')).toBe(false)
  })
})
