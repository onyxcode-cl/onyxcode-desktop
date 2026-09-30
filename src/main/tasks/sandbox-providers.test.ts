import { describe, expect, it } from 'vitest'
import { SANDBOX_PROVIDER_IDS } from '@shared/sandbox-providers'
import { PROVIDER_TARGETS } from './provider-egress'

describe('proveedores del sandbox', () => {
  it('la lista que ve la UI coincide con los proveedores que el sandbox realmente recibe', () => {
    expect([...SANDBOX_PROVIDER_IDS].sort()).toEqual(Object.keys(PROVIDER_TARGETS).sort())
  })
})
