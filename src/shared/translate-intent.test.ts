import { describe, expect, it } from 'vitest'
import { detectTranslateIntent, languageIn } from './translate-intent'

const pdf = { mime: 'application/pdf' }
const txt = { mime: 'text/plain' }

describe('detectTranslateIntent', () => {
  it.each([
    ['traduce este pdf al inglés', 'en'],
    ['Tradúcelo a español por favor', 'es'],
    ['traduce el documento a portugués manteniendo el diseño', 'pt'],
    ['please translate this to French', 'fr'],
    ['translate it into German', 'de'],
    ['pásalo al italiano', 'it'],
    ['quiero la versión en inglés', 'en']
  ])('«%s» → %s', (text, target) => {
    expect(detectTranslateIntent(text, [pdf], 'es')?.target).toBe(target)
  })

  it('sin idioma nombrado, usa el contrario al de la interfaz', () => {
    expect(detectTranslateIntent('traduce esto', [pdf], 'es')?.target).toBe('en')
    expect(detectTranslateIntent('translate this', [pdf], 'en')?.target).toBe('es')
  })

  it('con varios idiomas gana el que sigue a «a/al/en/to»', () => {
    expect(detectTranslateIntent('traduce este contrato en español al inglés', [pdf], 'es')?.target).toBe('en')
  })

  it('devuelve la posición del PDF entre los adjuntos', () => {
    expect(detectTranslateIntent('traduce al inglés', [txt, pdf], 'es')?.fileIndex).toBe(1)
  })

  it.each([
    'resume este pdf en inglés',
    'traduce solo el párrafo 2',
    'explícame qué dice la página 3',
    'summarize this in English',
    'hola, ¿qué dice?',
    ''
  ])('no ofrece nada para «%s»', (text) => {
    expect(detectTranslateIntent(text, [pdf], 'es')).toBeNull()
  })

  it('exige exactamente un PDF (ni cero, ni Word convertido a texto, ni dos)', () => {
    expect(detectTranslateIntent('traduce al inglés', [], 'es')).toBeNull()
    expect(detectTranslateIntent('traduce al inglés', [txt], 'es')).toBeNull()
    expect(detectTranslateIntent('traduce al inglés', [pdf, pdf], 'es')).toBeNull()
  })
})

describe('languageIn', () => {
  it('reconoce los seis idiomas y nada más', () => {
    expect(languageIn('en francés')).toBe('fr')
    expect(languageIn('a japonés')).toBeNull()
  })
})
