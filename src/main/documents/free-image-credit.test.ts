import { describe, expect, it } from 'vitest'
import { cleanImageAuthor, shortImageCredit } from './free-image-credit'
import h1 from './fixtures-free-images/h1-attribution-real.json'
import h6 from './fixtures-free-images/h6-attribution-real.json'

describe('pie breve a partir de metadatos comprobados', () => {
  it.each([h1, h6])('limpia el caso real $title sin tocar el original', (raw) => {
    const original = structuredClone(raw)
    const credit = shortImageCredit(raw)
    expect(credit.length).toBeLessThanOrEqual(120)
    expect(credit).toContain(raw.license)
    expect(credit).not.toMatch(/gallery|Flickr|https?:|This file|You are free/)
    expect(raw).toEqual(original)
  })
  it('quita HTML, enlaces y descripción de galería; limita solo el nombre visible', () => {
    expect(
      cleanImageAuthor(
        '<a href="https://example.org">Spielvogel</a> For a gallery of some more of my uploaded pictures you may see: here .'
      )
    ).toBe('Spielvogel')
    expect(cleanImageAuthor('Alice https://example.org/gallery')).toBe('Alice')
    const credit = shortImageCredit({ author: 'A'.repeat(800), license: 'CC BY-SA 4.0', provider: 'Wikimedia Commons' })
    expect(credit.length).toBe(120)
    expect(credit).toContain('… · CC BY-SA 4.0 · Wikimedia Commons')
  })
})
