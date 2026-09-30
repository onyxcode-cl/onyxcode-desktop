import { describe, expect, it } from 'vitest'
import { SANDBOX_PROVIDER_IDS } from '@shared/sandbox-providers'
import { PROVIDER_TARGETS } from './provider-egress'

describe('proveedores del sandbox', () => {
  it('la lista que ve la UI incluye los proveedores que el sandbox realmente recibe', () => {
    const ids = [...SANDBOX_PROVIDER_IDS]
    for (const id of Object.keys(PROVIDER_TARGETS)) expect(ids).toContain(id)
    // lo único extra son los modelos gratuitos de OpenCode (sin clave)
    expect(ids.filter((id) => !(id in PROVIDER_TARGETS))).toEqual(['opencode'])
  })
})
