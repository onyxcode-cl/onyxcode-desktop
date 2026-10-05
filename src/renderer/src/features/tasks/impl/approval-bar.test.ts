/** F8-B91: la barra solo se oculta si la tarjeta equivalente se ve; ante la duda, se muestra. */
import { describe, expect, it } from 'vitest'
import { shouldShowBar } from './PermissionPrompt'

describe('shouldShowBar', () => {
  it.each([
    [{ cardFound: false, cardVisible: false }, true],
    [{ cardFound: false, cardVisible: true }, true],
    [{ cardFound: true, cardVisible: false }, true],
    [{ cardFound: true, cardVisible: true }, false]
  ])('%j', (input, expected) => {
    expect(shouldShowBar(input)).toBe(expected)
  })
})
