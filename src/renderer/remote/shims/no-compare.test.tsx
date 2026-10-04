import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import * as shim from './no-compare'
import * as real from '../../src/features/compare'

describe('shims/no-compare (celular)', () => {
  it('exporta todo lo que exporta el índice real de «Comparar modelos»', () => {
    for (const name of Object.keys(real)) expect(Object.keys(shim), `falta «${name}»`).toContain(name)
  })

  it('es inerte: nada se pinta, nada se intercepta, nada se oculta', async () => {
    expect(renderToStaticMarkup(<shim.CompareControls mode="chat" directory={null} current={{ providerID: 'a', modelID: 'b' }} />)).toBe('')
    expect(renderToStaticMarkup(<shim.CompareConfirmDialog mode="code" directory="/x" />)).toBe('')
    expect(renderToStaticMarkup(<shim.RecoveryBanner mode="code" directory="/x" />)).toBe('')
    expect(shim.compareAvailable()).toBe(false)
    expect(shim.maybeInterceptSubmit()).toBe(false)
    expect(await shim.requestCompare()).toBe(false)
    expect(shim.useCompare.getState().armed['chat:']).toBeUndefined()
    expect(shim.useCompare((s) => s.loaded)).toBe(false)
    expect(shim.useShownCompare('code', '/x')).toBeNull()
    expect(shim.useCompareArmed('code', '/x')).toEqual({ armed: false, count: 0 })
    expect(shim.useHiddenCompareSession()()).toBe(false)
  })
})
