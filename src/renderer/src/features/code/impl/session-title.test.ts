import { describe, expect, it } from 'vitest'
import { displayTitle, isPlaceholderTitle } from './session-title'

describe('displayTitle', () => {
  it('oculta el título provisional de OpenCode', () => {
    expect(isPlaceholderTitle('New session - 2026-10-09T21:00:00.000Z')).toBe(true)
    expect(displayTitle('New session - 2026-10-09T21:00:00.000Z', 'Nueva sesión')).toBe('Nueva sesión')
    expect(displayTitle('', 'Nueva sesión')).toBe('Nueva sesión')
    expect(displayTitle(undefined, 'Nueva sesión')).toBe('Nueva sesión')
  })
  it('deja pasar un título real', () => {
    expect(displayTitle('Estado del proyecto', 'Nueva sesión')).toBe('Estado del proyecto')
    expect(displayTitle('New session for the API', 'x')).toBe('New session for the API')
  })
})
