import { describe, expect, it } from 'vitest'
import { SHELL_BG_WAKE_HEAD, shellBgWakeOf } from './shell-bg-wake-marker'

const part = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  type: 'text',
  text: `${SHELL_BG_WAKE_HEAD} 3 trabajos`,
  ...over
})

describe('shellBgWakeOf', () => {
  it('reconoce la marca de metadatos y lee el número de avisos y el tipo', () => {
    expect(shellBgWakeOf([part({ metadata: { lazunox: 'shell-bg-wake', jobs: 6, event: 'exit' } })])).toMatchObject({
      count: 6,
      kind: 'exit'
    })
    expect(shellBgWakeOf([part({ metadata: { lazunox: 'shell-bg-wake', jobs: 2, event: 'batch' } })])).toMatchObject({
      count: 2,
      kind: 'batch'
    })
    expect(shellBgWakeOf([part({ metadata: { lazunox: 'shell-bg-wake', event: 'possibly-stuck' } })])).toMatchObject({
      count: 1,
      kind: 'possibly-stuck'
    })
  })
  it('si el motor perdió los metadatos, lo reconoce por el encabezado', () => {
    expect(shellBgWakeOf([part()])).toMatchObject({ count: 1, kind: 'exit' })
  })
  it('un mensaje normal, una parte sintética o datos raros no son un aviso', () => {
    expect(shellBgWakeOf([{ type: 'text', text: 'hola' }])).toBeNull()
    expect(shellBgWakeOf([part({ synthetic: true })])).toBeNull()
    expect(shellBgWakeOf([{ type: 'file' }])).toBeNull()
    expect(shellBgWakeOf([])).toBeNull()
    expect(shellBgWakeOf([part({ metadata: { lazunox: 'shell-bg-wake', jobs: -4 } })])).toMatchObject({ count: 1 })
  })
})
